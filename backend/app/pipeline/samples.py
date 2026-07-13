"""Canned bilingual scenarios used by Simulation mode.

When no real ML model is installed, the Studio's *sample* flow uses one of these
scripts so the transcript, translation, timing and segment view all look exactly
like a real run. Translations were authored by hand for the demo languages; for
other targets the pipeline falls back gracefully (see nmt.py).
"""
from __future__ import annotations

# Each script: list of (start, end, english_source)
LECTURE = [
    (0.0, 4.2, "Welcome everyone. Today we will explore how neural networks learn."),
    (4.2, 8.6, "A neural network is built from layers of connected units called neurons."),
    (8.6, 12.9, "Each connection has a weight that the model adjusts during training."),
    (12.9, 17.1, "By comparing its predictions to the truth, the network reduces its error."),
    (17.1, 21.4, "This process repeats millions of times until the model improves."),
    (21.4, 25.0, "Thank you for watching, and I will see you in the next lesson."),
]

# target_lang code -> list of translated strings, aligned to LECTURE segments
LECTURE_TRANSLATIONS: dict[str, list[str]] = {
    "uz": [
        "Hammaga xush kelibsiz. Bugun neyron tarmoqlar qanday oʻrganishini koʻrib chiqamiz.",
        "Neyron tarmoq neyron deb ataladigan bogʻlangan birliklar qatlamlaridan tuzilgan.",
        "Har bir bogʻlanishda model oʻqitish vaqtida sozlaydigan ogʻirlik mavjud.",
        "Bashoratlarni haqiqat bilan solishtirib, tarmoq oʻz xatosini kamaytiradi.",
        "Bu jarayon model yaxshilanguncha millionlab marta takrorlanadi.",
        "Tomosha qilganingiz uchun rahmat, keyingi darsda koʻrishguncha.",
    ],
    "ru": [
        "Добро пожаловать. Сегодня мы разберём, как обучаются нейронные сети.",
        "Нейронная сеть состоит из слоёв связанных элементов, называемых нейронами.",
        "У каждой связи есть вес, который модель корректирует во время обучения.",
        "Сравнивая свои прогнозы с истиной, сеть уменьшает свою ошибку.",
        "Этот процесс повторяется миллионы раз, пока модель не улучшится.",
        "Спасибо за просмотр, увидимся на следующем уроке.",
    ],
    "es": [
        "Bienvenidos a todos. Hoy exploraremos cómo aprenden las redes neuronales.",
        "Una red neuronal se construye con capas de unidades conectadas llamadas neuronas.",
        "Cada conexión tiene un peso que el modelo ajusta durante el entrenamiento.",
        "Al comparar sus predicciones con la verdad, la red reduce su error.",
        "Este proceso se repite millones de veces hasta que el modelo mejora.",
        "Gracias por ver el vídeo, nos vemos en la próxima lección.",
    ],
    "fr": [
        "Bienvenue à tous. Aujourd'hui, nous verrons comment les réseaux de neurones apprennent.",
        "Un réseau de neurones est constitué de couches d'unités connectées appelées neurones.",
        "Chaque connexion possède un poids que le modèle ajuste pendant l'entraînement.",
        "En comparant ses prédictions à la vérité, le réseau réduit son erreur.",
        "Ce processus se répète des millions de fois jusqu'à ce que le modèle s'améliore.",
        "Merci d'avoir regardé, et à la prochaine leçon.",
    ],
    "de": [
        "Willkommen zusammen. Heute untersuchen wir, wie neuronale Netze lernen.",
        "Ein neuronales Netz besteht aus Schichten verbundener Einheiten, den Neuronen.",
        "Jede Verbindung hat ein Gewicht, das das Modell während des Trainings anpasst.",
        "Indem es seine Vorhersagen mit der Wahrheit vergleicht, verringert das Netz seinen Fehler.",
        "Dieser Vorgang wiederholt sich millionenfach, bis sich das Modell verbessert.",
        "Danke fürs Zuschauen, wir sehen uns in der nächsten Lektion.",
    ],
}

SAMPLE_SCENARIOS = {
    "lecture": {
        "title": "AI Lecture — “How Neural Networks Learn”",
        "source_lang": "en",
        "segments": LECTURE,
        "translations": LECTURE_TRANSLATIONS,
    }
}


def get_scenario(name: str = "lecture") -> dict:
    return SAMPLE_SCENARIOS.get(name, SAMPLE_SCENARIOS["lecture"])
