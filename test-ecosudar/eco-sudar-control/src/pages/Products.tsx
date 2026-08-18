import { Search, Edit, Trash2, MoreHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  fetchProducts, deleteProduct, type UIProduct as Product,
} from "@/lib/api/products";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { exportToExcel, type ExportColumn } from "@/lib/exporters";
import { Pagination, usePagedRows } from "@/components/Pagination";

interface SubPurposeMap {
  [purpose: string]: string[];
}

const productCategories = [
  "Pellets", "Biomass Stove", "Biomass Burner",
  "Eco-Friendly Plates", "Eco-Friendly Bowls", "Eco-Friendly Cups",
  "Cutlery", "Food Containers", "Straws & Stirrers",
];

export default function Products() {
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setLoading(true);
    fetchProducts()
      .then(setProducts)
      .catch(() => toast.error("Failed to load products"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = products.filter(p =>
    p.product.toLowerCase().includes(search.toLowerCase()) ||
    p.category.toLowerCase().includes(search.toLowerCase())
  );

  const paged = usePagedRows(filtered);

  const exportProducts = () => {
    if (!filtered.length) { toast.error("No products to export"); return; }
    const columns: ExportColumn<Product>[] = [
      { header: "Product", key: "product" },
      { header: "Category", key: "category" },
      { header: "Description", key: "description" },
      { header: "Base Price", key: (p) => p._raw?.base_price ?? "" },
      { header: "Unit", key: (p) => p._raw?.unit ?? "" },
      { header: "Min Order Qty", key: "minOrderQty" },
      { header: "Sizes", key: (p) => p.sizes.map((s) => s.size).join(", ") },
    ];
    exportToExcel({ sheetName: "Products", columns, rows: filtered, filename: "products" });
    toast.success(`Exported ${filtered.length} products`);
  };

  const handleDelete = async (p: Product) => {
    try {
      await deleteProduct(p.id);
      setProducts(products.filter(x => x.id !== p.id));
      toast.success(`Product "${p.product}" deleted`);
    } catch {
      toast.error("Failed to delete product");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Products</h1>
          <p className="text-muted-foreground">Manage products shown in mobile app</p>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={exportProducts}>
                Export to Excel
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button className="gap-2" onClick={() => navigate("/products/new")}>
            + Add Product
          </Button>
        </div>
      </div>

      <div className="bg-card rounded-xl border shadow-sm">
        <div className="p-4 border-b">
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search products..." className="pl-10" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <ScrollableX>
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Product</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Category</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Sizes & Prices</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Purposes</th>
                
                
                <th className="text-right px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">Loading products...</td></tr>
              ) : paged.rows.map((p) => (
                <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      {p.imageUrl && <img src={p.imageUrl} alt={p.product} className="h-8 w-8 rounded object-cover" />}
                      <span className="text-sm font-medium text-card-foreground">{p.product}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">{p.category}</td>
                  <td className="px-6 py-4">
                    <div className="space-y-1">
                      {p.sizes.map((sp, i) => (
                        <div key={i} className="text-xs text-muted-foreground">
                          <span className="font-medium text-card-foreground">{sp.size}</span> — {sp.price}
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="space-y-1">
                      {p.purposes.map((pur, i) => (
                        <div key={i}>
                          <span className="text-xs font-medium text-card-foreground">{pur}</span>
                          {p.subPurposes[pur] && p.subPurposes[pur].length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {p.subPurposes[pur].map((sp, j) => (
                                <span key={j} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{sp}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </td>
                  
                  
                  <td className="px-6 py-4 text-right">
                    <button onClick={() => navigate(`/products/${p.id}/edit`)} className="p-1.5 hover:bg-muted rounded-lg mr-1"><Edit className="h-4 w-4 text-muted-foreground" /></button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button className="p-1.5 hover:bg-destructive/10 rounded-lg"><Trash2 className="h-4 w-4 text-destructive" /></button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete "{p.product}"?</AlertDialogTitle>
                          <AlertDialogDescription>This will remove the product from the mobile app.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDelete(p)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">No products found</td></tr>
              )}
            </tbody>
          </table>
        </ScrollableX>
        <Pagination {...paged} onPage={paged.setPage} noun="products" />
      </div>
    </div>
  );
}
