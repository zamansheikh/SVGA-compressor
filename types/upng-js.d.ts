declare module "upng-js" {
  /**
   * Encodes one or more RGBA frames into a PNG byte stream.
   * @param imgs Array of ArrayBuffers holding RGBA (8-bit) pixel data.
   * @param w    Image width.
   * @param h    Image height.
   * @param cnum Color count: 0 for lossless 24-bit PNG, 1..256 for palette.
   * @param dels Optional per-frame delays for APNG.
   */
  export function encode(
    imgs: ArrayBuffer[],
    w: number,
    h: number,
    cnum: number,
    dels?: number[],
  ): ArrayBuffer;

  const UPNG: {
    encode: typeof encode;
  };
  export default UPNG;
}
