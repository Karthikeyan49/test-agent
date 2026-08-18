import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

interface GuardApi {
  setDirty: (key: string, dirty: boolean) => void;
  confirmLeave: () => Promise<boolean>;
}

const UnsavedChangesContext = createContext<GuardApi | null>(null);

export function useConfirmLeave(): () => Promise<boolean> {
  const ctx = useContext(UnsavedChangesContext);
  return useCallback(() => ctx?.confirmLeave() ?? Promise.resolve(true), [ctx]);
}

export function useUnsavedChanges(dirty: boolean, key: string): void {
  const ctx = useContext(UnsavedChangesContext);
  useEffect(() => {
    ctx?.setDirty(key, dirty);
  }, [ctx, key, dirty]);
  useEffect(() => () => ctx?.setDirty(key, false), [ctx, key]);
}

function internalLinkFrom(target: EventTarget | null): HTMLAnchorElement | null {
  if (!(target instanceof Element)) return null;
  const anchor = target.closest("a");
  if (!anchor || !(anchor instanceof HTMLAnchorElement)) return null;
  if (anchor.target === "_blank" || anchor.hasAttribute("download")) return null;
  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("#") || /^[a-z]+:/i.test(href)) return null;
  if (anchor.origin !== window.location.origin) return null;
  return anchor;
}

export function UnsavedChangesProvider({ children }: { children: React.ReactNode }) {
  const dirtyKeys = useRef(new Set<string>());
  const [pending, setPending] = useState<
    { replay?: HTMLElement; resolve?: (ok: boolean) => void } | null
  >(null);
  const bypass = useRef(false);

  const setDirty = useCallback((key: string, dirty: boolean) => {
    if (dirty) dirtyKeys.current.add(key);
    else dirtyKeys.current.delete(key);
  }, []);

  const confirmLeave = useCallback(() => {
    if (dirtyKeys.current.size === 0) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => setPending({ resolve }));
  }, []);

  useEffect(() => {
    const onClickCapture = (e: MouseEvent) => {
      if (bypass.current || dirtyKeys.current.size === 0) return;
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (!(e.target instanceof Element)) return;

      const anchor = internalLinkFrom(e.target);
      const marked = e.target.closest<HTMLElement>("[data-navigates]");
      const trigger = anchor ?? marked;
      if (!trigger) return;

      if (anchor && anchor.pathname === window.location.pathname) return;

      e.preventDefault();
      e.stopPropagation();
      setPending({ replay: trigger });
    };

    document.addEventListener("click", onClickCapture, true);
    return () => document.removeEventListener("click", onClickCapture, true);
  }, []);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyKeys.current.size === 0) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const stay = () => {
    pending?.resolve?.(false);
    setPending(null);
  };

  const discard = () => {
    const { replay, resolve } = pending ?? {};
    setPending(null);
    dirtyKeys.current.clear();
    resolve?.(true);
    if (!replay) return;
    bypass.current = true;
    replay.click();
    setTimeout(() => { bypass.current = false; }, 0);
  };

  return (
    <UnsavedChangesContext.Provider value={{ setDirty, confirmLeave }}>
      {children}
      <Dialog open={pending !== null} onOpenChange={(open) => { if (!open) stay(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Leave this page?
            </DialogTitle>
            <DialogDescription>
              If you leave, your unsaved changes will be discarded.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button onClick={stay}>Stay here</Button>
            <Button variant="outline" onClick={discard}>Leave &amp; discard changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </UnsavedChangesContext.Provider>
  );
}
