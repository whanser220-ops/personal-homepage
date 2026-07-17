import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";

import { cn } from "../../lib/utils.js";

const buttonVariants = cva("ui-button", {
  variants: {
    variant: {
      default: "ui-button-default",
      secondary: "ui-button-secondary",
      ghost: "ui-button-ghost",
    },
    size: {
      default: "ui-button-md",
      sm: "ui-button-sm",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

export function Button({ asChild = false, className, size, variant, ...props }) {
  const Comp = asChild ? Slot : "button";

  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
