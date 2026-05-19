import "solid-js";

declare module "solid-js" {
  namespace JSX {
    interface HTMLAttributes<T> {
      fg?: string;
      dim?: boolean;
      bold?: boolean;
    }

    interface SVGAttributes<T> {
      fg?: string;
      dim?: boolean;
      bold?: boolean;
    }

    interface TextSVGAttributes<T> {
      fg?: string;
      dim?: boolean;
      bold?: boolean;
    }

    interface IntrinsicElements {
      box: {
        children?: Element;
        flexDirection?: "row" | "column";
        padding?: number;
        paddingX?: number;
        borderStyle?: string;
        gap?: number;
        onMouseDown?: (event: { button: number; preventDefault?: () => void }) => void;
      };
    }
  }
}
