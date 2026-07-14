import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

type MarkdownBodyProps = {
  children: string;
  className?: string;
};

export function MarkdownBody({ children, className }: MarkdownBodyProps) {
  return (
    <div className={cn("markdown-body", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
