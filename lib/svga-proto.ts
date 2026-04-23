/**
 * Minimal sprite schema used ONLY by the preview renderer.
 *
 * We deliberately omit `ShapeEntity` and the `shapes` field on FrameEntity —
 * real-world SVGA files have exporter-specific variations in shape encoding
 * that can desync a strict decoder. protobufjs treats the omitted field 5 as
 * an unknown length-delimited field and safely skips it, which means frames
 * still decode even when their shape list is exotic. The renderer doesn't
 * draw shape layers anyway.
 */
export const SVGA_SPRITE_PROTO = `
syntax = "proto3";
package com.opensource.svga;

message Layout {
  float x = 1;
  float y = 2;
  float width = 3;
  float height = 4;
}

message Transform {
  float a = 1;
  float b = 2;
  float c = 3;
  float d = 4;
  float tx = 5;
  float ty = 6;
}

message FrameEntity {
  float alpha = 1;
  Layout layout = 2;
  Transform transform = 3;
  string clipPath = 4;
  // field 5 (shapes) intentionally omitted — skipped as unknown.
}

message SpriteEntity {
  string imageKey = 1;
  repeated FrameEntity frames = 2;
  string matteKey = 3;
}
`;
