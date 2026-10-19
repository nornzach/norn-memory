import { NornWordmark } from "@/components/misc/norn-mark";

export default function ThemeAwareLogo({ height = 40 }: { height?: number }) {
  return <NornWordmark size={Math.round(height * 0.8)} />;
}
