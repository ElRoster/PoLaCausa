import fs from "node:fs/promises";
import path from "node:path";
import { v2 as cloudinary } from "cloudinary";
import { config } from "../config.js";

const uploadsDir = path.resolve("uploads");

const cloudinaryReady =
  Boolean(config.cloudinary.cloudName) &&
  Boolean(config.cloudinary.apiKey) &&
  Boolean(config.cloudinary.apiSecret);

if (cloudinaryReady) {
  cloudinary.config({
    cloud_name: config.cloudinary.cloudName,
    api_key: config.cloudinary.apiKey,
    api_secret: config.cloudinary.apiSecret
  });
}

function extensionFromMime(mimetype: string) {
  if (mimetype === "image/png") return ".png";
  if (mimetype === "image/webp") return ".webp";
  if (mimetype === "image/gif") return ".gif";
  return ".jpg";
}

async function saveLocalImage(file: Express.Multer.File) {
  await fs.mkdir(uploadsDir, { recursive: true });
  const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${extensionFromMime(file.mimetype)}`;
  await fs.writeFile(path.join(uploadsDir, filename), file.buffer);
  return `/uploads/${filename}`;
}

function uploadToCloudinary(file: Express.Multer.File) {
  return new Promise<string>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "polacausa/products",
        resource_type: "image",
        transformation: [
          { width: 1100, height: 900, crop: "limit" },
          { quality: "auto", fetch_format: "auto" }
        ]
      },
      (error, result) => {
        if (error || !result?.secure_url) {
          reject(error ?? new Error("Cloudinary no devolvio una URL valida."));
          return;
        }
        resolve(result.secure_url);
      }
    );

    stream.end(file.buffer);
  });
}

export async function uploadProductImage(file?: Express.Multer.File) {
  if (!file) return null;
  if (!cloudinaryReady) return saveLocalImage(file);
  return uploadToCloudinary(file);
}
