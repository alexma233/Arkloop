package imageutil

import (
	"bytes"
	"image"
	_ "image/gif"
	"image/jpeg"
	"image/png"
	"strings"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const (
	maxPromptImageDimension = 2048
	maxPromptImageBytes     = 3 * 1024 * 1024
)

var promptImageJPEGSteps = []struct {
	dimension int
	quality   int
}{
	{2048, 85},
	{1792, 82},
	{1536, 80},
	{1280, 78},
	{1024, 75},
}

// ProcessImage keeps prompt images readable: preserve supported images when
// already within the model-facing dimension cap, otherwise resize by dimension.
func ProcessImage(data []byte, mimeType string) ([]byte, string) {
	return processImageForPrompt(data, mimeType)
}

// ProcessModelInputImage uses the same image-preserving path as ProcessImage.
func ProcessModelInputImage(data []byte, mimeType string) ([]byte, string) {
	return processImageForPrompt(data, mimeType)
}

func DecodeImageMimeType(data []byte, fallback string) (string, bool) {
	if len(data) == 0 {
		return "", false
	}
	_, format, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return "", false
	}
	return mimeTypeForFormat(format, fallback), true
}

func processImageForPrompt(data []byte, mimeType string) ([]byte, string) {
	if len(data) == 0 {
		return data, mimeType
	}

	img, format, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return data, mimeType
	}

	if format == "gif" && len(data) <= maxPromptImageBytes {
		return data, "image/gif"
	}

	normalizedMime := mimeTypeForFormat(format, mimeType)
	if len(data) <= maxPromptImageBytes && fitsPromptDimensions(img) && canPreserveSourceBytes(format) {
		return data, normalizedMime
	}

	out, outMime, err := encodePromptImage(img, format)
	if err != nil {
		return data, mimeType
	}
	return out, outMime
}

func fitsPromptDimensions(img image.Image) bool {
	bounds := img.Bounds()
	return bounds.Dx() <= maxPromptImageDimension && bounds.Dy() <= maxPromptImageDimension
}

func canPreserveSourceBytes(format string) bool {
	switch format {
	case "jpeg", "png", "webp":
		return true
	default:
		return false
	}
}

func mimeTypeForFormat(format, fallback string) string {
	switch format {
	case "jpeg":
		return "image/jpeg"
	case "png":
		return "image/png"
	case "gif":
		return "image/gif"
	case "webp":
		return "image/webp"
	default:
		if normalized := normalizeImageMimeType(fallback); strings.HasPrefix(normalized, "image/") {
			return normalized
		}
		return fallback
	}
}

func scaleToFit(img image.Image, maxDim int) image.Image {
	bounds := img.Bounds()
	w, h := bounds.Dx(), bounds.Dy()

	longer := w
	if h > w {
		longer = h
	}
	if longer <= maxDim {
		return img
	}

	ratio := float64(maxDim) / float64(longer)
	newW := int(float64(w) * ratio)
	newH := int(float64(h) * ratio)
	if newW < 1 {
		newW = 1
	}
	if newH < 1 {
		newH = 1
	}

	dst := image.NewRGBA(image.Rect(0, 0, newW, newH))
	draw.CatmullRom.Scale(dst, dst.Bounds(), img, bounds, draw.Over, nil)
	return dst
}

func encodePromptImage(img image.Image, sourceFormat string) ([]byte, string, error) {
	if sourceFormat == "png" {
		scaled := scaleToFit(img, maxPromptImageDimension)
		var buf bytes.Buffer
		if err := png.Encode(&buf, scaled); err != nil {
			return nil, "", err
		}
		if buf.Len() <= maxPromptImageBytes {
			return buf.Bytes(), "image/png", nil
		}
		img = scaled
	}

	var last []byte
	for _, step := range promptImageJPEGSteps {
		scaled := scaleToFit(img, step.dimension)
		out, mime, err := encodeJPEG(scaled, step.quality)
		if err != nil {
			return nil, "", err
		}
		last = out
		if len(out) <= maxPromptImageBytes {
			return out, mime, nil
		}
	}
	return last, "image/jpeg", nil
}

func encodeJPEG(img image.Image, quality int) ([]byte, string, error) {
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: quality}); err != nil {
		return nil, "", err
	}
	return buf.Bytes(), "image/jpeg", nil
}

func normalizeImageMimeType(mimeType string) string {
	return strings.ToLower(strings.TrimSpace(strings.Split(mimeType, ";")[0]))
}
