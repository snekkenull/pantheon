declare module "three-spritetext" {
  class SpriteText {
    constructor(text?: string, textHeight?: number, color?: string);
    text: string;
    textHeight: number;
    color: string;
    backgroundColor: string;
    padding: number;
    borderWidth: number;
    borderRadius: number;
    borderColor: string;
    fontFace: string;
    fontSize: number;
    fontWeight: string;
    strokeWidth: number;
    strokeColor: string;
    position: { x: number; y: number; z: number };
  }

  export = SpriteText;
}
