import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { createPortal } from "react-dom";

export const TruncatedText: React.FC<{ text: string; limit?: number }> = ({
  text,
  limit = 100,
}) => {
  if (!text) return null;
  if (text.length <= limit) return <span>{text}</span>;

  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <span className="cursor-pointer">{text?.slice(0, limit)}...</span>
      </HoverCardTrigger>
      {createPortal(
        <HoverCardContent
          className="z-[9999] rounded-lg border border-line bg-panel p-4 text-sm text-ink shadow-elev-2"
          style={{
            minWidth: "min(400px, calc(100vw - 2rem))",
            maxWidth: "min(600px, calc(100vw - 2rem))",
            width: "auto", // Allows it to adapt based on content
            transform: "translateY(10px)",
            whiteSpace: "normal", // Wraps text to prevent overflow
            overflowWrap: "break-word", // Breaks long words to fit within max-width
          }}
        >
          <p className="">{text}</p>
        </HoverCardContent>,
        document.body,
      )}
    </HoverCard>
  );
};
