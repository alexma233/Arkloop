package imageutil

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func solidPNG(w, h int, fill color.Color) []byte {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, fill)
		}
	}
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return buf.Bytes()
}

func decodeTestImage(t *testing.T, data []byte) image.Image {
	t.Helper()
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("decode image: %v", err)
	}
	return img
}

func TestPrepareModelInputImagePreservesSmallImageWithKey(t *testing.T) {
	source := solidPNG(320, 180, color.RGBA{R: 240, G: 40, B: 40, A: 255})

	out, mime := PrepareModelInputImage(source, "image/png", "attachments/account/thread/image.jpg")
	if !bytes.Equal(out, source) {
		t.Fatal("expected original bytes for image within prompt dimensions")
	}
	if mime != "image/png" {
		t.Fatalf("unexpected mime: %q", mime)
	}
}

func TestPrepareModelInputImageWithoutKeyPassthrough(t *testing.T) {
	source := solidPNG(64, 64, color.RGBA{R: 10, G: 20, B: 30, A: 255})

	out, mime := PrepareModelInputImage(source, "image/png", "")
	if !bytes.Equal(out, source) {
		t.Fatal("expected original bytes when key is empty")
	}
	if mime != "image/png" {
		t.Fatalf("unexpected mime: %q", mime)
	}
}

func TestPrepareModelInputImageDecodeFailureFallsBack(t *testing.T) {
	source := []byte("not-an-image")

	out, mime := PrepareModelInputImage(source, "image/jpeg", "attachments/a/b/c.jpg")
	if !bytes.Equal(out, source) {
		t.Fatal("expected original bytes on decode failure")
	}
	if mime != "image/jpeg" {
		t.Fatalf("unexpected mime: %q", mime)
	}
}

func TestPrepareModelInputImageResizesLargeImage(t *testing.T) {
	source := makePNG(4000, 3000)

	out, mime := PrepareModelInputImage(source, "image/png", "attachments/account/thread/image.png")
	if mime != "image/jpeg" && mime != "image/png" {
		t.Fatalf("unexpected mime: %q", mime)
	}
	if len(out) > maxPromptImageBytes {
		t.Fatalf("output should fit prompt byte budget, got %d", len(out))
	}
	img := decodeTestImage(t, out)
	if b := img.Bounds(); b.Dx() > maxPromptImageDimension || b.Dy() > maxPromptImageDimension {
		t.Fatalf("resized image should fit within %d, got %dx%d", maxPromptImageDimension, b.Dx(), b.Dy())
	}
}
