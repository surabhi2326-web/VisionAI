
import os
import re
import time
from io import BytesIO
from urllib.parse import urlparse

import numpy as np
import tensorflow as tf
from PIL import Image, UnidentifiedImageError
from flask import Flask, jsonify, render_template, request


app = Flask(__name__)

# Maximum uploaded image size: 8 MB
MAX_UPLOAD_MB = float(os.environ.get("MAX_UPLOAD_MB", "8"))
app.config["MAX_CONTENT_LENGTH"] = int(MAX_UPLOAD_MB * 1024 * 1024)

# These names MUST stay in exactly the same order as model training.
CLASS_NAMES = [
    "Ardilla",
    "Buho",
    "Chachalaca",
    "Copeton",
    "Coyote",
    "CucoArdilla",
    "Cuyeo",
    "Garrobo",
    "HalconPeregrino",
    "Mofeta",
    "Oropendola",
    "OropendolaDeBaltimore",
    "Paloma",
    "PalomaAliblanca",
    "Pizote",
    "Rascon",
    "Tepezcuintle",
    "Tijo",
    "Tinamu",
    "TiranoMelancolico",
    "Venado",
    "Yiguirro",
    "Zopilote",
    "ZorroGris",
    "ZorroPelon",
    "Cat",
    "Dog",
]

IMG_SIZE = 128

CONFIG = {
    "modelType": "wildwatch",
    "classNames": CLASS_NAMES,
    "maxUploadMb": MAX_UPLOAD_MB,
    "highThreshold": 0.80,
    "lowThreshold": 0.50,
    "defaultModelUrl": "",
}

# Load the trained model once when the server starts.
MODEL_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "wildwatch_27_species.keras",
)

model = None
MODEL_LOAD_ERROR = None

try:
    if not os.path.exists(MODEL_PATH):
        raise FileNotFoundError(
            f"Model file not found: {MODEL_PATH}"
        )

    model = tf.keras.models.load_model(MODEL_PATH)

    if model.output_shape[-1] != len(CLASS_NAMES):
        raise ValueError(
            f"Expected 27 model outputs, found {model.output_shape[-1]}."
        )

    print("WildWatch model loaded successfully!")
    print("Model outputs:", model.output_shape[-1])

except Exception as error:
    MODEL_LOAD_ERROR = str(error)
    print("Could not load WildWatch model:", MODEL_LOAD_ERROR)


# Keep the existing model URL validation route for compatibility.
TM_PATTERN = re.compile(r"^/models/[A-Za-z0-9_\-]+/?$")


def normalize_model_url(raw):
    raw = (raw or "").strip()

    if not raw:
        return None, "Enter a model URL."

    parsed = urlparse(raw)

    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return None, "Enter a valid HTTP or HTTPS URL."

    path = re.sub(r"/(model|metadata)\.json$", "/", parsed.path)

    if not path.endswith("/"):
        path += "/"

    if (
        parsed.netloc == "teachablemachine.withgoogle.com"
        and not TM_PATTERN.match(path)
    ):
        return None, "Use a valid Teachable Machine model URL."

    return f"{parsed.scheme}://{parsed.netloc}{path}", None


@app.get("/")
def dashboard():
    return render_template("dashboard.html", config=CONFIG)


@app.get("/api/config")
def get_config():
    return jsonify(CONFIG)


@app.get("/api/model-status")
def model_status():
    if model is None:
        return jsonify({
            "ready": False,
            "error": MODEL_LOAD_ERROR,
        }), 503

    return jsonify({
        "ready": True,
        "modelType": "WildWatch TensorFlow/Keras",
        "classes": len(CLASS_NAMES),
        "inputSize": IMG_SIZE,
    })


@app.post("/api/predict")
def predict():
    if model is None:
        return jsonify({
            "error": f"WildWatch model is unavailable: {MODEL_LOAD_ERROR}"
        }), 503

    uploaded_file = request.files.get("image")

    if uploaded_file is None:
        return jsonify({"error": "Please upload an image."}), 400

    started = time.perf_counter()

    try:
        image = Image.open(uploaded_file.stream).convert("RGB")
        image = image.resize((IMG_SIZE, IMG_SIZE))

        # Training pipeline used pixel values between 0 and 1.
        pixels = np.asarray(image, dtype=np.float32) / 255.0
        batch = np.expand_dims(pixels, axis=0)

        probabilities = model.predict(batch, verbose=0)[0]

        if len(probabilities) != len(CLASS_NAMES):
            return jsonify({
                "error": "Model output does not match the 27 class labels."
            }), 500

        order = np.argsort(probabilities)[::-1]

        predictions = [
            {
                "className": CLASS_NAMES[int(index)],
                "probability": float(probabilities[index]),
            }
            for index in order
        ]

        elapsed_ms = round(
            (time.perf_counter() - started) * 1000
        )

        return jsonify({
            "predictions": predictions,
            "topPrediction": predictions[0],
            "inferenceTimeMs": elapsed_ms,
        })

    except (UnidentifiedImageError, OSError, ValueError):
        return jsonify({
            "error": "Could not read that image. Try a JPG or PNG image."
        }), 400

    except Exception as error:
        app.logger.exception("WildWatch prediction failed")
        return jsonify({
            "error": "Prediction failed. Check the server terminal."
        }), 500


@app.post("/api/validate-model-url")
def validate_model_url():
    data = request.get_json(silent=True) or {}

    url, error = normalize_model_url(data.get("url"))

    if error:
        return jsonify({"ok": False, "error": error}), 400

    return jsonify({"ok": True, "url": url})


@app.errorhandler(404)
def not_found(_):
    return jsonify({"ok": False, "error": "Not found"}), 404


@app.errorhandler(413)
def file_too_large(_):
    return jsonify({
        "error": f"Image is too large. Maximum size is {MAX_UPLOAD_MB:g} MB."
    }), 413


if __name__ == "__main__":
    # Debug is disabled to avoid repeatedly loading the ML model.
    app.run(
        debug=False,
        host="127.0.0.1",
        port=int(os.environ.get("PORT", "5000")),
    )
