"""Native wrapper around the OneOCR runtime extracted from Windows Snipping Tool."""

from __future__ import annotations

import ctypes
import os
import sys
from ctypes import POINTER, Structure, byref, c_char_p, c_int32, c_int64, c_ubyte
from pathlib import Path

from PIL import Image

MODEL_KEY = b'kj)TGtrK>f]b[Piow.gU+nC@s""""""4'


class ImageStructure(Structure):
    _fields_ = [
        ("type", c_int32),
        ("width", c_int32),
        ("height", c_int32),
        ("_reserved", c_int32),
        ("step_size", c_int64),
        ("data_ptr", POINTER(c_ubyte)),
    ]


class NativeOneOCR:
    def __init__(self, bin_dir: Path) -> None:
        if sys.platform != "win32":
            raise RuntimeError("Native OneOCR requires Windows")

        self.bin_dir = bin_dir.resolve()
        required = ("oneocr.dll", "oneocr.onemodel", "onnxruntime.dll")
        missing = [name for name in required if not (self.bin_dir / name).is_file()]
        if missing:
            raise FileNotFoundError(f"Missing OneOCR runtime files in {self.bin_dir}: {missing}")

        self._dll_dir = os.add_dll_directory(str(self.bin_dir))
        self.dll = ctypes.WinDLL(str(self.bin_dir / "oneocr.dll"))
        self._configure_api()

        self.init_options = c_int64()
        self.pipeline = c_int64()
        self.process_options = c_int64()
        self._check(self.dll.CreateOcrInitOptions(byref(self.init_options)), "CreateOcrInitOptions")
        self._check(
            self.dll.OcrInitOptionsSetUseModelDelayLoad(self.init_options, 0),
            "OcrInitOptionsSetUseModelDelayLoad",
        )
        self._check(
            self.dll.CreateOcrPipeline(
                str(self.bin_dir / "oneocr.onemodel").encode(),
                MODEL_KEY,
                self.init_options,
                byref(self.pipeline),
            ),
            "CreateOcrPipeline",
        )
        self._check(self.dll.CreateOcrProcessOptions(byref(self.process_options)), "CreateOcrProcessOptions")

    def _configure_api(self) -> None:
        dll = self.dll
        dll.CreateOcrInitOptions.restype = c_int64
        dll.CreateOcrInitOptions.argtypes = [POINTER(c_int64)]
        dll.OcrInitOptionsSetUseModelDelayLoad.restype = c_int64
        dll.OcrInitOptionsSetUseModelDelayLoad.argtypes = [c_int64, ctypes.c_char]
        dll.CreateOcrPipeline.restype = c_int64
        dll.CreateOcrPipeline.argtypes = [c_char_p, c_char_p, c_int64, POINTER(c_int64)]
        dll.CreateOcrProcessOptions.restype = c_int64
        dll.CreateOcrProcessOptions.argtypes = [POINTER(c_int64)]
        dll.RunOcrPipeline.restype = c_int64
        dll.RunOcrPipeline.argtypes = [c_int64, POINTER(ImageStructure), c_int64, POINTER(c_int64)]
        dll.GetOcrLineCount.restype = c_int64
        dll.GetOcrLineCount.argtypes = [c_int64, POINTER(c_int64)]
        dll.GetOcrLine.restype = c_int64
        dll.GetOcrLine.argtypes = [c_int64, c_int64, POINTER(c_int64)]
        dll.GetOcrLineContent.restype = c_int64
        dll.GetOcrLineContent.argtypes = [c_int64, POINTER(c_char_p)]
        dll.ReleaseOcrResult.restype = None
        dll.ReleaseOcrResult.argtypes = [c_int64]
        dll.ReleaseOcrProcessOptions.restype = None
        dll.ReleaseOcrProcessOptions.argtypes = [c_int64]
        dll.ReleaseOcrPipeline.restype = None
        dll.ReleaseOcrPipeline.argtypes = [c_int64]
        dll.ReleaseOcrInitOptions.restype = None
        dll.ReleaseOcrInitOptions.argtypes = [c_int64]

    @staticmethod
    def _check(code: int, operation: str) -> None:
        if code != 0:
            raise RuntimeError(f"{operation} failed: {code:#x}")

    def recognize_file(self, image_path: Path) -> str:
        with Image.open(image_path) as source:
            rgba = source.convert("RGBA")
            r, g, b, a = rgba.split()
            bgra = Image.merge("RGBA", (b, g, r, a))
            raw = bgra.tobytes()

        buffer = (c_ubyte * len(raw)).from_buffer_copy(raw)
        image = ImageStructure(
            type=3,
            width=bgra.width,
            height=bgra.height,
            _reserved=0,
            step_size=bgra.width * 4,
            data_ptr=buffer,
        )
        result = c_int64()
        self._check(
            self.dll.RunOcrPipeline(self.pipeline, byref(image), self.process_options, byref(result)),
            "RunOcrPipeline",
        )
        try:
            line_count = c_int64()
            self._check(self.dll.GetOcrLineCount(result, byref(line_count)), "GetOcrLineCount")
            lines: list[str] = []
            for index in range(line_count.value):
                line = c_int64()
                self._check(self.dll.GetOcrLine(result, index, byref(line)), "GetOcrLine")
                text_ptr = c_char_p()
                self._check(self.dll.GetOcrLineContent(line, byref(text_ptr)), "GetOcrLineContent")
                if text_ptr.value:
                    lines.append(text_ptr.value.decode("utf-8", errors="strict"))
            return "\n".join(lines)
        finally:
            if result.value:
                self.dll.ReleaseOcrResult(result)

    def close(self) -> None:
        if self.process_options.value:
            self.dll.ReleaseOcrProcessOptions(self.process_options)
            self.process_options = c_int64()
        if self.pipeline.value:
            self.dll.ReleaseOcrPipeline(self.pipeline)
            self.pipeline = c_int64()
        if self.init_options.value:
            self.dll.ReleaseOcrInitOptions(self.init_options)
            self.init_options = c_int64()
        self._dll_dir.close()

    def __enter__(self) -> "NativeOneOCR":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()
