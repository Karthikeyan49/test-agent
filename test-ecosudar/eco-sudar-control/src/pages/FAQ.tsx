import { Plus, Edit, Trash2, HelpCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Req } from "@/components/Req";
import {
  Dialog, DialogContent, DialogScrollContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { faqApi, type FAQ } from "@/lib/api/faq";

export default function FAQPage() {
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editFaq, setEditFaq] = useState<FAQ | null>(null);
  const [form, setForm] = useState({ question: "", answer: "" });

  useEffect(() => {
    faqApi.list()
      .then(setFaqs)
      .catch(() => toast.error("Failed to load FAQs"))
      .finally(() => setLoading(false));
  }, []);

  const openAdd = () => {
    setEditFaq(null);
    setForm({ question: "", answer: "" });
    setDialogOpen(true);
  };

  const openEdit = (faq: FAQ) => {
    setEditFaq(faq);
    setForm({ question: faq.question, answer: faq.answer });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.question.trim() || !form.answer.trim()) {
      toast.error("Both question and answer are required");
      return;
    }
    try {
      if (editFaq) {
        await faqApi.update(editFaq.id, { question: form.question, answer: form.answer });
        setFaqs(prev => prev.map(f => f.id === editFaq.id ? { ...f, ...form } : f));
        toast.success("FAQ updated successfully");
      } else {
        const created = await faqApi.create(form);
        setFaqs(prev => [...prev, created]);
        toast.success("FAQ added successfully");
      }
      setDialogOpen(false);
    } catch {
      toast.error("Failed to save FAQ");
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await faqApi.remove(id);
      setFaqs(prev => prev.filter(f => f.id !== id));
      toast.success("FAQ deleted");
    } catch {
      toast.error("Failed to delete FAQ");
    }
  };

  const toggleActive = async (id: number) => {
    const faq = faqs.find(f => f.id === id);
    if (!faq) return;
    const newActive = !faq.active;
    setFaqs(prev => prev.map(f => f.id === id ? { ...f, active: newActive } : f));
    try {
      await faqApi.update(id, { active: newActive });
    } catch {
      setFaqs(prev => prev.map(f => f.id === id ? { ...f, active: faq.active } : f));
      toast.error("Failed to toggle FAQ");
    }
  };

  const moveUp = async (index: number) => {
    if (index === 0) return;
    const arr = [...faqs];
    [arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
    setFaqs(arr);
    try {
      await faqApi.reorder(arr.map(f => f.id));
    } catch {
      toast.error("Failed to save order");
    }
  };

  const moveDown = async (index: number) => {
    if (index === faqs.length - 1) return;
    const arr = [...faqs];
    [arr[index], arr[index + 1]] = [arr[index + 1], arr[index]];
    setFaqs(arr);
    try {
      await faqApi.reorder(arr.map(f => f.id));
    } catch {
      toast.error("Failed to save order");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-card-foreground">FAQ Management</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage frequently asked questions shown in the mobile app</p>
        </div>
        <Button onClick={openAdd} className="gap-2">
          <Plus className="h-4 w-4" /> Add FAQ
        </Button>
      </div>

      {/* FAQ list */}
      <div className="space-y-3">
        {loading && (
          <div className="text-center py-12 text-muted-foreground bg-card rounded-xl border border-border">
            Loading FAQs…
          </div>
        )}
        {!loading && faqs.map((faq, index) => (
          <div key={faq.id} className={`bg-card rounded-xl border border-border p-4 transition-opacity ${!faq.active ? "opacity-50" : ""}`}>
            <div className="flex items-start gap-3">
              <div className="flex flex-col gap-1 mt-1">
                <button onClick={() => moveUp(index)} className="text-muted-foreground hover:text-card-foreground p-0.5" disabled={index === 0}>
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                </button>
                <button onClick={() => moveDown(index)} className="text-muted-foreground hover:text-card-foreground p-0.5" disabled={index === faqs.length - 1}>
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </button>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <HelpCircle className="h-4 w-4 text-primary shrink-0" />
                  <h3 className="font-medium text-card-foreground">{faq.question}</h3>
                </div>
                <p className="text-sm text-muted-foreground ml-6">{faq.answer}</p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Switch checked={faq.active} onCheckedChange={() => toggleActive(faq.id)} />
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(faq)}>
                  <Edit className="h-4 w-4" />
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete FAQ?</AlertDialogTitle>
                      <AlertDialogDescription>This will remove the FAQ from the mobile app.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleDelete(faq.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </div>
        ))}
        {!loading && faqs.length === 0 && (
          <div className="text-center py-12 text-muted-foreground bg-card rounded-xl border border-border">
            No FAQs added yet. Click "Add FAQ" to create one.
          </div>
        )}
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogScrollContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editFaq ? "Edit FAQ" : "Add FAQ"}</DialogTitle>
            <DialogDescription>{editFaq ? "Update the question and answer" : "Add a new FAQ for the mobile app"}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-card-foreground">Question <Req /></label>
              <Input value={form.question} onChange={e => setForm(f => ({ ...f, question: e.target.value }))} placeholder="e.g. What is the minimum order quantity?" className="mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium text-card-foreground">Answer <Req /></label>
              <Textarea value={form.answer} onChange={e => setForm(f => ({ ...f, answer: e.target.value }))} placeholder="Type the answer..." className="mt-1" rows={4} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>{editFaq ? "Update" : "Add"}</Button>
          </DialogFooter>
        </DialogScrollContent>
      </Dialog>
    </div>
  );
}
