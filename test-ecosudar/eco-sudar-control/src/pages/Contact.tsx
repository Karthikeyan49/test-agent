import { Mail, Phone, MapPin, MessageSquare, Headset, Clock } from "lucide-react";

export default function Contact() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Contact & Support</h1>
        <p className="text-muted-foreground">Reach out to the EcoSudar team for help</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Headset className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Support</h2>
          </div>
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-3">
              <Mail className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-foreground">Email</p>
                <a href="mailto:support@ecosudar.com" className="text-primary hover:underline">
                  support@ecosudar.com
                </a>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Phone className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-foreground">Phone</p>
                <a href="tel:+919876543210" className="text-primary hover:underline">
                  +91 98765 43210
                </a>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-foreground">Working Hours</p>
                <p className="text-muted-foreground">Mon – Sat, 9:00 AM – 6:00 PM IST</p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-xl border shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Office Address</h2>
          </div>
          <div className="text-sm space-y-1 text-muted-foreground">
            <p className="font-medium text-foreground">Bio Energy LLP</p>
            <p>EcoSudar Biomass Solutions</p>
            <p>Tamil Nadu, India</p>
          </div>
        </div>
      </div>

      <div className="bg-card rounded-xl border shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <MessageSquare className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Quick Help</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            { title: "Order Issues", desc: "Problems with a customer order or delivery status" },
            { title: "Invoice Queries", desc: "Help with GST invoices, GSTIN, or tax documents" },
            { title: "Account Access", desc: "Login issues, password resets, or account settings" },
            { title: "Product Catalog", desc: "Adding/updating products visible in the mobile app" },
            { title: "Payments", desc: "Payment status, refund processing, or reconciliation" },
            { title: "Technical Issues", desc: "App errors, data sync problems, or feature requests" },
          ].map((item) => (
            <div key={item.title} className="rounded-lg border bg-muted/30 p-4">
              <p className="font-medium text-sm text-foreground">{item.title}</p>
              <p className="text-xs text-muted-foreground mt-1">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
