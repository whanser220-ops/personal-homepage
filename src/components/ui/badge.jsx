import { cn } from "../../lib/utils.js";

export function Badge({ className, variant = "default", ...props }) {
  return <span className={cn("ui-badge", `ui-badge-${variant}`, className)} {...props} />;
}
