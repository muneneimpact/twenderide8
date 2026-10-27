// Browser-only: resize photos before sending them through account saving.
export async function prepareBrandImage(file: File, kind: "logo" | "cover"): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    throw new Error("Choose a PNG, JPG or WebP image. For HEIC photos, export a JPG first.");
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Could not open that photo. Please choose another image."));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context || !image.naturalWidth || !image.naturalHeight) throw new Error("Could not prepare this photo.");
    const scale = Math.min(1, (kind === "cover" ? 1600 : 640) / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const limit = kind === "cover" ? 680_000 : 430_000;
    for (let quality = 0.85; quality >= 0.35; quality -= 0.1) {
      const result = canvas.toDataURL("image/webp", quality);
      if (result.length <= limit) return result;
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const previous = document.createElement("canvas");
      previous.width = canvas.width;
      previous.height = canvas.height;
      previous.getContext("2d")?.drawImage(canvas, 0, 0);
      canvas.width = Math.max(1, Math.round(canvas.width * 0.75));
      canvas.height = Math.max(1, Math.round(canvas.height * 0.75));
      context.drawImage(previous, 0, 0, canvas.width, canvas.height);
      const result = canvas.toDataURL("image/webp", 0.7);
      if (result.length <= limit) return result;
    }
    throw new Error("Could not prepare this photo. Please choose a smaller image.");
  } finally {
    URL.revokeObjectURL(url);
  }
}