import { ImageResponse } from "next/og";
import OpengraphImage, { alt as ogAlt, size as ogSize, contentType as ogType } from "./opengraph-image";

export const dynamic = "force-dynamic";
export const alt = ogAlt;
export const size = ogSize;
export const contentType = ogType;

export default async function TwitterImage(): Promise<ImageResponse> {
  return OpengraphImage();
}
