package imageutil

import (
	"bytes"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/jpeg"
	"image/png"
	"testing"
)

func makeJPEG(w, h, quality int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	// 用伪随机填充以生成不可压缩的图片
	for i := range img.Pix {
		img.Pix[i] = byte((i*7 + 13) % 256)
	}
	var buf bytes.Buffer
	_ = jpeg.Encode(&buf, img, &jpeg.Options{Quality: quality})
	return buf.Bytes()
}

func makePNG(w, h int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	// 更高熵：xorshift 伪随机
	s := uint32(0xDEADBEEF)
	for i := range img.Pix {
		s ^= s << 13
		s ^= s >> 17
		s ^= s << 5
		img.Pix[i] = byte(s)
	}
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return buf.Bytes()
}

func pngConfigOnly(w, h int) []byte {
	var buf bytes.Buffer
	buf.Write([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'})
	var ihdr bytes.Buffer
	_ = binary.Write(&ihdr, binary.BigEndian, uint32(w))
	_ = binary.Write(&ihdr, binary.BigEndian, uint32(h))
	ihdr.Write([]byte{8, 2, 0, 0, 0})
	writePNGChunk(&buf, "IHDR", ihdr.Bytes())
	writePNGChunk(&buf, "IEND", nil)
	return buf.Bytes()
}

func writePNGChunk(buf *bytes.Buffer, kind string, data []byte) {
	_ = binary.Write(buf, binary.BigEndian, uint32(len(data)))
	buf.WriteString(kind)
	buf.Write(data)
	crc := crc32.NewIEEE()
	_, _ = crc.Write([]byte(kind))
	_, _ = crc.Write(data)
	_ = binary.Write(buf, binary.BigEndian, crc.Sum32())
}

func TestProcessImage_SmallImagePassthrough(t *testing.T) {
	data := makeJPEG(100, 100, 90)
	out, mime := ProcessImage(data, "image/jpeg")
	if !bytes.Equal(out, data) {
		t.Error("small image should be returned unchanged")
	}
	if mime != "image/jpeg" {
		t.Errorf("mime should be unchanged, got %s", mime)
	}
}

func TestProcessImage_GIFPassthrough(t *testing.T) {
	data := make([]byte, 1024)
	copy(data, []byte("GIF89a"))
	out, mime := ProcessImage(data, "image/gif")
	if !bytes.Equal(out, data) {
		t.Error("GIF should be returned unchanged")
	}
	if mime != "image/gif" {
		t.Errorf("GIF mime should be unchanged, got %s", mime)
	}
}

func TestProcessImage_DecodeFallback(t *testing.T) {
	data := make([]byte, 1024)
	data[0] = 0xFF // 非法图片数据
	out, mime := ProcessImage(data, "image/jpeg")
	if !bytes.Equal(out, data) {
		t.Error("decode failure should return original data")
	}
	if mime != "image/jpeg" {
		t.Errorf("mime should be unchanged on decode failure, got %s", mime)
	}
}

func TestDecodeImageMimeTypeRejectsHugePixelBudget(t *testing.T) {
	data := pngConfigOnly(100000, 100000)
	if _, ok := DecodeImageMimeType(data, "image/png"); ok {
		t.Fatal("expected huge image dimensions to be rejected before full decode")
	}
}

func TestProcessImage_LargeJPEGCompressed(t *testing.T) {
	data := makeJPEG(3000, 3000, 100)
	out, mime := ProcessImage(data, "image/jpeg")
	if mime != "image/jpeg" {
		t.Errorf("output should be JPEG, got %s", mime)
	}
	if len(out) >= len(data) {
		t.Errorf("output should be smaller than input: %d >= %d", len(out), len(data))
	}
	img, _, err := image.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("decode output: %v", err)
	}
	if b := img.Bounds(); b.Dx() > maxPromptImageDimension || b.Dy() > maxPromptImageDimension {
		t.Fatalf("resized image should fit within %d, got %dx%d", maxPromptImageDimension, b.Dx(), b.Dy())
	}
}

func TestProcessImage_LargePNGCompressed(t *testing.T) {
	data := makePNG(4000, 3000)
	out, mime := ProcessImage(data, "image/png")
	if mime != "image/jpeg" && mime != "image/png" {
		t.Errorf("output should remain model-visible image, got %s", mime)
	}
	if len(out) >= len(data) {
		t.Errorf("output should be smaller than input")
	}
	if len(out) > maxPromptImageBytes {
		t.Fatalf("output should fit prompt byte budget, got %d", len(out))
	}
	img, _, err := image.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("decode output: %v", err)
	}
	if b := img.Bounds(); b.Dx() > maxPromptImageDimension || b.Dy() > maxPromptImageDimension {
		t.Fatalf("resized image should fit within %d, got %dx%d", maxPromptImageDimension, b.Dx(), b.Dy())
	}
}

func TestProcessImage_SmallDimensionLargePNGBounded(t *testing.T) {
	data := makePNG(1600, 1600)
	if len(data) <= maxPromptImageBytes {
		t.Fatalf("test setup: expected PNG larger than byte budget, got %d", len(data))
	}
	out, mime := ProcessImage(data, "image/png")
	if mime != "image/jpeg" {
		t.Fatalf("expected oversized small-dimension PNG to be JPEG, got %s", mime)
	}
	if len(out) > maxPromptImageBytes {
		t.Fatalf("output should fit prompt byte budget, got %d", len(out))
	}
	img, _, err := image.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("decode output: %v", err)
	}
	if b := img.Bounds(); b.Dx() > maxPromptImageDimension || b.Dy() > maxPromptImageDimension {
		t.Fatalf("bounded image should fit within %d, got %dx%d", maxPromptImageDimension, b.Dx(), b.Dy())
	}
}

func TestProcessModelInputImage_UsesPromptDimensionBudget(t *testing.T) {
	data := makePNG(4000, 3000)
	out, mime := ProcessModelInputImage(data, "image/png")
	if mime != "image/jpeg" && mime != "image/png" {
		t.Errorf("output should remain model-visible image, got %s", mime)
	}
	if len(out) > maxPromptImageBytes {
		t.Fatalf("output should fit prompt byte budget, got %d", len(out))
	}
	img, _, err := image.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("decode output: %v", err)
	}
	if b := img.Bounds(); b.Dx() > maxPromptImageDimension || b.Dy() > maxPromptImageDimension {
		t.Fatalf("resized image should fit within %d, got %dx%d", maxPromptImageDimension, b.Dx(), b.Dy())
	}
}

func TestScaleToFit_NoOpWhenSmall(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 100, 200))
	result := scaleToFit(img, 2048)
	b := result.Bounds()
	if b.Dx() != 100 || b.Dy() != 200 {
		t.Errorf("small image should not be scaled, got %dx%d", b.Dx(), b.Dy())
	}
}

func TestScaleToFit_ScalesLargeImage(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 4000, 2000))
	result := scaleToFit(img, maxPromptImageDimension)
	b := result.Bounds()
	if b.Dx() > maxPromptImageDimension || b.Dy() > maxPromptImageDimension {
		t.Errorf("scaled image should fit within %d, got %dx%d", maxPromptImageDimension, b.Dx(), b.Dy())
	}
	if b.Dx() != maxPromptImageDimension {
		t.Errorf("longer side should be %d, got %d", maxPromptImageDimension, b.Dx())
	}
}
