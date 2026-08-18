import { useRef, useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface ScrollableXProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Wraps any horizontally-scrollable container and renders a floating mirror
 * scrollbar via a portal, fixed at the bottom of the viewport. The bar is
 * only shown when the element is actually wider than its container and is
 * currently visible on screen.
 */
export function ScrollableX({ children, className }: ScrollableXProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const mirrorRef  = useRef<HTMLDivElement>(null);
  const syncing    = useRef(false);

  const [bar, setBar] = useState<{
    visible: boolean;
    left: number;
    width: number;
    scrollWidth: number;
  }>({ visible: false, left: 0, width: 0, scrollWidth: 0 });

  const refresh = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vh   = window.innerHeight;
    const hasH = el.scrollWidth > el.clientWidth + 2;
    setBar({
      visible:     hasH && rect.top < vh - 10 && rect.bottom > 10,
      left:        rect.left,
      width:       rect.width,
      scrollWidth: el.scrollWidth,
    });
  }, []);

  // Sync content → mirror
  const onContentScroll = useCallback(() => {
    if (!syncing.current && mirrorRef.current && contentRef.current) {
      syncing.current = true;
      mirrorRef.current.scrollLeft = contentRef.current.scrollLeft;
      syncing.current = false;
    }
    refresh();
  }, [refresh]);

  // Sync mirror → content
  const onMirrorScroll = useCallback(() => {
    if (!syncing.current && mirrorRef.current && contentRef.current) {
      syncing.current = true;
      contentRef.current.scrollLeft = mirrorRef.current.scrollLeft;
      syncing.current = false;
    }
  }, []);

  useEffect(() => {
    const el   = contentRef.current;
    const main = document.querySelector("main");
    if (!el) return;

    el.addEventListener("scroll", onContentScroll, { passive: true });
    main?.addEventListener("scroll", refresh, { passive: true });
    window.addEventListener("resize", refresh);

    const ro = new ResizeObserver(refresh);
    ro.observe(el);

    refresh();

    return () => {
      el.removeEventListener("scroll", onContentScroll);
      main?.removeEventListener("scroll", refresh);
      window.removeEventListener("resize", refresh);
      ro.disconnect();
    };
  }, [onContentScroll, refresh]);

  return (
    <>
      <div ref={contentRef} className={cn("overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]", className)}>
        {children}
      </div>

      {bar.visible && createPortal(
        <div
          style={{
            position:     "fixed",
            bottom:       6,
            left:         bar.left,
            width:        bar.width,
            height:       16,
            zIndex:       9999,
            background:   "rgba(255,255,255,0.92)",
            borderRadius: 8,
            border:       "1px solid rgba(0,0,0,0.12)",
            boxShadow:    "0 1px 4px rgba(0,0,0,0.10)",
            padding:      "2px 0",
          }}
        >
          <div
            ref={mirrorRef}
            onScroll={onMirrorScroll}
            className="eco-float-scroll"
            style={{
              overflowX:      "auto",
              overflowY:      "hidden",
              height:         "100%",
              borderRadius:   8,
              scrollbarWidth: "thin",
              scrollbarColor: "rgba(0,0,0,0.35) transparent",
            } as React.CSSProperties}
          >
            <div style={{ width: bar.scrollWidth, height: 1 }} />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
