"""
Face detection for automatic reframing — OpenCV's YuNet (a ~230 KB ONNX
model), fast on a CPU. Reads a JSON list of frame images, prints one JSON
object per frame: {"i": index, "faces": [[cx, cy, w, h, score], ...]} with
everything normalised to 0-1 of the frame.

    python face_detect.py <model.onnx> <frames.json>
"""
import json
import sys

import cv2


def main():
    model, listing = sys.argv[1], sys.argv[2]
    frames = json.load(open(listing, encoding="utf-8"))
    det = None
    size = None
    for item in frames:
        img = cv2.imread(item["path"])
        if img is None:
            print(json.dumps({"i": item["i"], "faces": []}), flush=True)
            continue
        h, w = img.shape[:2]
        if det is None or size != (w, h):
            det = cv2.FaceDetectorYN.create(model, "", (w, h), 0.6, 0.3, 50)
            size = (w, h)
        _, found = det.detect(img)
        faces = []
        if found is not None:
            for f in found:
                x, y, fw, fh, score = float(f[0]), float(f[1]), float(f[2]), float(f[3]), float(f[-1])
                faces.append([round((x + fw / 2) / w, 4), round((y + fh / 2) / h, 4), round(fw / w, 4), round(fh / h, 4), round(score, 3)])
        print(json.dumps({"i": item["i"], "faces": faces}), flush=True)


if __name__ == "__main__":
    main()
