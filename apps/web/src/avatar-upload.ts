/** Normalize local raster input to the existing server's PNG/128px/16KB contract. */
export async function avatarUpload(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG or WebP image.');
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('Choose an image smaller than 20 MB.');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40000000) throw new Error('Choose a smaller photo, up to 40 megapixels.');
    for (const limit of [128, 112, 96, 80, 64, 48]) {
      const scale = Math.min(1, limit / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d'); if (!context) throw new Error('Image resizing is unavailable in this browser.');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('The image could not be resized.')), 'image/png'));
      if (blob.size <= 16384) return btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
    }
    throw new Error('We couldn’t resize this photo. Try cropping it or choosing another image.');
  } finally { bitmap.close(); }
}
