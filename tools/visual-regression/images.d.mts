// Narrow declarations for the only synchronous PNG APIs used here. No @types dependency.
declare module 'pngjs' {
  export interface Image {
    width: number;
    height: number;
    data: Buffer;
  }
  export const PNG: {
    new (options: { width: number; height: number }): Image;
    sync: {
      read(input: Buffer): Image;
      write(image: Image): Buffer;
    };
  };
}
