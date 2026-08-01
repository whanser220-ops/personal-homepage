import { cn } from "../../lib/utils.js";
import { Slot } from "@radix-ui/react-slot";

export function Card({ asChild = false, className, ...props }) {
  const Comp = asChild ? Slot : "div";

  return <Comp className={cn("ui-card", className)} {...props} />;
}

export function CardHeader({ className, ...props }) {
  return <div className={cn("ui-card-header", className)} {...props} />;
}

export function CardTitle({ className, ...props }) {
  return <h3 className={cn("ui-card-title", className)} {...props} />;
}

export function CardDescription({ className, ...props }) {
  return <p className={cn("ui-card-description", className)} {...props} />;
}

export function CardContent({ className, ...props }) {
  return <div className={cn("ui-card-content", className)} {...props} />;
}

export function CardFooter({ className, ...props }) {
  return <div className={cn("ui-card-footer", className)} {...props} />;
}
