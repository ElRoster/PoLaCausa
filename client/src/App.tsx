import {
  BarChart3,
  Beer,
  Boxes,
  Clock3,
  Edit3,
  Eye,
  EyeOff,
  LogOut,
  Minus,
  Moon,
  Plus,
  ReceiptText,
  Search,
  ShieldCheck,
  Sun,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { API_URL, Session, api, money } from "./api";

type Category = {
  id: string;
  name: string;
  color: string;
  description?: string;
  products_count?: number;
};

type Product = {
  id: string;
  name: string;
  sku: string;
  description?: string;
  category_id?: string;
  category_name?: string;
  category_color?: string;
  price: number;
  employee_discount_percent: number;
  cost: number;
  stock: number;
  min_stock: number;
  abv: number;
  origin?: string;
  image_url?: string;
};

type Dashboard = {
  totals: { income: number; expenses: number; balance_adjustments: number; sales_count: number };
  topProducts: Array<{ name: string; quantity: number; total: number }>;
  lowStock: Product[];
  productivity: Array<{ id: string; name: string; sales_count: number; total: number }>;
  moneyFlow: Array<{ type: string; amount: number; label: string; created_at: string }>;
};

type ExpenseType = {
  id: string;
  name: string;
  color: string;
  description?: string;
  expenses_count?: number;
};

type Period = "all" | "day" | "week" | "month";
type EmployeeCredit = {
  id: string;
  user_name: string;
  amount: number;
  status: "pending" | "paid";
  created_at: string;
  paid_at?: string;
};

type CashRegisterInfo = {
  register: {
    id: string;
    base_amount: number;
    closing_amount?: number;
    expected_cash?: number;
    discrepancy?: number;
    closed_at?: string;
  } | null;
  summary: {
    base_amount: number;
    cash_sales: number;
    paid_credits: number;
    expenses: number;
    pending_credits: number;
    expected_cash: number;
    discrepancy?: number;
  };
};

type SalePaymentMethod = "cash" | "transfer" | "flexible" | "credit";
type SaleDraft = {
  payment_method: SalePaymentMethod;
  cash_received: number;
  transfer_received: number;
};

type View = "dashboard" | "inventory" | "sales" | "accounting" | "users" | "shifts";
type ConfirmOptions = {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: "default" | "danger";
};

const nav: Array<readonly [View, typeof BarChart3, string, string[]]> = [
  ["dashboard", BarChart3, "Panel", ["all"]],
  ["inventory", Boxes, "Inventario", ["all", "products:read"]],
  ["sales", ReceiptText, "Ventas", ["all", "sales:read", "sales:create"]],
  ["accounting", ShieldCheck, "Contabilidad", ["all", "accounting:limited"]],
  ["users", Users, "Usuarios", ["all"]],
  ["shifts", Clock3, "Jornadas", ["all", "shifts:manage"]]
] as const;

function canAccess(user: Session["user"], permissions: string[]) {
  return permissions.some((permission) => user.permissions.includes(permission));
}

const defaultProduct = {
  name: "",
  sku: "",
  description: "",
  category_id: "",
  price: 0,
  employee_discount_percent: 0,
  cost: 0,
  stock: 0,
  min_stock: 0,
  origin: ""
};

export function App() {
  const [session, setSession] = useState<Session | null>(() => {
    const raw = localStorage.getItem("pola-session");
    return raw ? JSON.parse(raw) : null;
  });
  const [theme, setTheme] = useState(() => localStorage.getItem("pola-theme") ?? "dark");
  const [view, setView] = useState<View>("dashboard");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [workNotice, setWorkNotice] = useState<"start" | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<
    (ConfirmOptions & { resolve: (confirmed: boolean) => void }) | null
  >(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("pola-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(""), 5000);
    return () => window.clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(""), 9000);
    return () => window.clearTimeout(timer);
  }, [success]);

  function saveSession(next: Session | null) {
    setSession(next);
    if (next) localStorage.setItem("pola-session", JSON.stringify(next));
    else localStorage.removeItem("pola-session");
  }

  const isEmployee = session ? !session.user.permissions.includes("all") : false;

  useEffect(() => {
    if (!session || !isEmployee) return;
    let cancelled = false;
    api("/shifts/active", {}, session.token)
      .then((active) => {
        if (!cancelled && !active) setWorkNotice("start");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [session?.token]);

  function confirmAction(options: ConfirmOptions) {
    return new Promise<boolean>((resolve) => {
      setConfirmDialog({ ...options, resolve });
    });
  }

  function closeConfirm(confirmed: boolean) {
    confirmDialog?.resolve(confirmed);
    setConfirmDialog(null);
  }

  async function requestLogout() {
    if (!session) return;
    if (isEmployee) {
      try {
        const active = await api("/shifts/active", {}, session.token);
        if (active) {
          const shouldEnd = await confirmAction({
            title: "Jornada activa",
            message: "Tienes una jornada activa. ¿Planeas terminarla antes de cerrar sesion?",
            confirmText: "Si, terminar jornada",
            cancelText: "No, cerrar sesion"
          });
          if (shouldEnd) {
            setView("shifts");
            return;
          }
          saveSession(null);
          return;
        }
      } catch {
        setError("No se pudo validar la jornada antes de cerrar sesion.");
        return;
      }
    }
    saveSession(null);
  }

  function goToShiftFromNotice() {
    setWorkNotice(null);
    setView("shifts");
  }

  if (!session) return <Login onLogin={saveSession} theme={theme} setTheme={setTheme} />;

  const visibleNav = nav.filter(([, , , permissions]) => canAccess(session.user, permissions));
  const activeView = visibleNav.some(([id]) => id === view) ? view : visibleNav[0]?.[0] ?? "sales";

  if (activeView !== view) {
    window.setTimeout(() => setView(activeView), 0);
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Beer size={27} />
          </span>
          <div>
            <strong>PoLa Causa</strong>
            <small>Ventas, inventario y caja</small>
          </div>
        </div>
        <nav>
          {visibleNav.map(([id, Icon, label]) => (
            <button
              className={activeView === id ? "active" : ""}
              key={id}
              onClick={() => setView(id)}
              title={label}
            >
              <Icon size={19} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">Tienda de cervezas</p>
            <h1>{visibleNav.find(([id]) => id === activeView)?.[2] ?? "Panel"}</h1>
          </div>
          <div className="top-actions">
            <button className="icon-button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <div className="user-pill">
              <span>{session.user.name}</span>
              <small>{session.user.role}</small>
            </div>
            <button className="icon-button" onClick={requestLogout}>
              <LogOut size={18} />
            </button>
          </div>
        </header>

        {error && (
          <NoticeModal kind="error" title="No se pudo completar la accion" message={error} onClose={() => setError("")} />
        )}
        {success && (
          <NoticeModal kind="success" title="Accion completada" message={success} onClose={() => setSuccess("")} />
        )}
        {loading && <Loader />}

        <section className="workspace">
          {activeView === "dashboard" && (
            <DashboardView token={session.token} currentUser={session.user} confirm={confirmAction} setError={setError} setSuccess={setSuccess} setLoading={setLoading} />
          )}
          {activeView === "inventory" && (
            <Inventory token={session.token} currentUser={session.user} confirm={confirmAction} setError={setError} setSuccess={setSuccess} setLoading={setLoading} />
          )}
          {activeView === "sales" && (
            <Sales token={session.token} currentUser={session.user} confirm={confirmAction} setError={setError} setSuccess={setSuccess} setLoading={setLoading} />
          )}
          {activeView === "accounting" && (
            <Accounting token={session.token} currentUser={session.user} confirm={confirmAction} setError={setError} setSuccess={setSuccess} setLoading={setLoading} />
          )}
          {activeView === "users" && (
            <UsersView token={session.token} currentUser={session.user} confirm={confirmAction} setError={setError} setSuccess={setSuccess} setLoading={setLoading} />
          )}
          {activeView === "shifts" && (
            <Shifts token={session.token} currentUser={session.user} confirm={confirmAction} setError={setError} setSuccess={setSuccess} setLoading={setLoading} />
          )}
        </section>
      </main>
      {confirmDialog && (
        <ConfirmModal
          options={confirmDialog}
          onCancel={() => closeConfirm(false)}
          onConfirm={() => closeConfirm(true)}
        />
      )}
      {workNotice && (
        <WorkNoticeModal
          type={workNotice}
          onConfirm={goToShiftFromNotice}
        />
      )}
    </div>
  );
}

function Login({
  onLogin,
  theme,
  setTheme
}: {
  onLogin: (session: Session) => void;
  theme: string;
  setTheme: (theme: string) => void;
}) {
  const [email, setEmail] = useState("admin@polacausa.com");
  const [password, setPassword] = useState("PolaCausa2026!");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      onLogin(
        await api<Session>("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password })
        })
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-scene">
      <button className="theme-float" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
        {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
      </button>
      <form className="login-panel" onSubmit={submit}>
        <div className="brand login-brand">
          <span className="brand-mark">
            <Beer size={30} />
          </span>
          <div>
            <strong>PoLa Causa</strong>
            <small>Control total de barra, caja e inventario</small>
          </div>
        </div>
        <label>
          Usuario de acceso
          <input value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label>
          Password
          <PasswordInput value={password} onChange={setPassword} />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="primary" disabled={loading}>
          {loading ? "Fermentando acceso..." : "Entrar seguro"}
        </button>
      </form>
    </div>
  );
}

function DashboardView(props: ViewProps) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [period, setPeriod] = useState<Period>("all");

  async function refresh() {
    await loadData(`/accounting/dashboard?period=${period}`, props, setData);
  }

  useEffect(() => {
    refresh();
  }, [period]);

  async function deleteProductivity(item: Dashboard["productivity"][number]) {
    const confirmed = await props.confirm({
      title: "Eliminar productividad",
      message: `Quitar del panel la productividad de "${item.name}". Las ventas y la contabilidad no se borraran.`,
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      tone: "danger"
    });
    if (!confirmed) return;
    const ok = await mutate(props, `/accounting/productivity/${item.id}`, { method: "DELETE" }, refresh);
    if (ok) props.setSuccess("Dato de productividad eliminado del panel.");
  }

  if (!data) return <Empty title="Preparando indicadores" />;
  const net = data.totals.income - data.totals.expenses + data.totals.balance_adjustments;

  return (
    <div className="grid-stack">
      <PeriodFilter value={period} onChange={setPeriod} />
      <div className="metric-grid">
        <Metric label="Ingresos" value={money.format(data.totals.income)} />
        <Metric label="Egresos" value={money.format(data.totals.expenses)} />
        <Metric label="Descuadres" value={money.format(data.totals.balance_adjustments)} />
        <Metric label="Caja neta" value={money.format(net)} tone="gold" />
      </div>
      <div className="two-col">
        <Panel title="Productos estrella">
          <TopProductsPie items={data.topProducts} />
        </Panel>
        <Panel title="Productividad">
          <div className="productivity-list">
            {data.productivity.length === 0 && <Empty title="Sin datos de productividad" compact />}
            {data.productivity.map((item) => (
              <div className="action-row" key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <small>{item.sales_count} ventas · {money.format(item.total)}</small>
                </div>
                <button className="icon-button danger-action" onClick={() => deleteProductivity(item)} title="Eliminar del panel">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <div className="two-col">
        <Panel title="Alertas de inventario">
          {data.lowStock.length === 0 && <Empty title="Sin productos criticos" compact />}
          {data.lowStock.map((product) => (
            <Row key={product.id} left={product.name} right={`${product.stock}/${product.min_stock}`} />
          ))}
        </Panel>
        <Panel title="Movimiento contable">
          <div className="scroll-list">
            {data.moneyFlow.map((flow, index) => (
              <Row key={`${flow.created_at}-${index}`} left={`${flow.type} · ${flow.label}`} right={money.format(flow.amount)} />
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function TopProductsPie({ items }: { items: Dashboard["topProducts"] }) {
  const palette = ["#f5b942", "#28d17c", "#38bdf8", "#f97316", "#ef4444", "#a78bfa"];
  const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0);
  const leader = items[0];
  const leaderPercent = leader && totalUnits > 0 ? Math.round((leader.quantity / totalUnits) * 100) : 0;
  let cursor = 0;
  const gradient =
    totalUnits > 0
      ? items.map((item, index) => {
          const start = cursor;
          const end = cursor + (item.quantity / totalUnits) * 100;
          cursor = end;
          return `${palette[index % palette.length]} ${start}% ${end}%`;
        }).join(", ")
      : "var(--surface-2) 0% 100%";

  if (!items.length || totalUnits === 0) return <Empty title="Sin ventas registradas" compact />;

  return (
    <div className="pie-panel">
      <div className="pie-chart" style={{ background: `conic-gradient(${gradient})` }}>
        <div className="pie-center">
          <span>{leaderPercent}%</span>
          <small>mas vendido</small>
        </div>
      </div>
      <div className="pie-summary">
        <strong>{leader.name}</strong>
        <small>{leader.quantity} uds vendidas · {money.format(leader.total)}</small>
      </div>
      <div className="pie-legend">
        {items.map((item, index) => {
          const percent = Math.round((item.quantity / totalUnits) * 100);
          return (
            <div className="pie-item" key={item.name}>
              <span style={{ "--dot": palette[index % palette.length] } as React.CSSProperties} />
              <div>
                <strong>{item.name}</strong>
                <small>{percent}% · {item.quantity} uds · {money.format(item.total)}</small>
                <div className="pie-bar">
                  <i style={{ width: `${percent}%`, background: palette[index % palette.length] }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type ViewProps = {
  token: string;
  currentUser: Session["user"];
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  setError: (error: string) => void;
  setSuccess: (message: string) => void;
  setLoading: (loading: boolean) => void;
};

function explainRequired(label: string) {
  return `No se pudo guardar: completa el campo "${label}".`;
}

function numberInputValue(value: number) {
  return value === 0 ? "" : String(value);
}

function readNumberInput(value: string) {
  return value === "" ? 0 : Number(value);
}

function paymentLabel(method: string) {
  if (method === "cash") return "Efectivo";
  if (method === "transfer") return "Transferencia";
  if (method === "flexible") return "Flexible";
  if (method === "credit") return "Credito empleado";
  return method;
}

function PeriodFilter({ value, onChange }: { value: Period; onChange: (period: Period) => void }) {
  return (
    <div className="period-filter">
      <button className={value === "all" ? "active" : ""} onClick={() => onChange("all")}>Todo</button>
      <button className={value === "day" ? "active" : ""} onClick={() => onChange("day")}>Dia</button>
      <button className={value === "week" ? "active" : ""} onClick={() => onChange("week")}>Semana</button>
      <button className={value === "month" ? "active" : ""} onClick={() => onChange("month")}>Mes</button>
    </div>
  );
}

async function loadData<T>(path: string, props: ViewProps, setter: (data: T) => void) {
  props.setLoading(true);
  props.setError("");
  try {
    setter(await api<T>(path, {}, props.token));
  } catch (err) {
    props.setError((err as Error).message);
  } finally {
    props.setLoading(false);
  }
}

function Inventory(props: ViewProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [stockMode, setStockMode] = useState("");
  const [form, setForm] = useState(defaultProduct);
  const [image, setImage] = useState<File | null>(null);
  const [categoryForm, setCategoryForm] = useState({ name: "", color: "#f59e0b" });
  const [modal, setModal] = useState<"product" | "category" | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  async function refresh() {
    const qs = new URLSearchParams({ search, category, stockMode });
    await Promise.all([
      loadData(`/products?${qs.toString()}`, props, setProducts),
      loadData("/categories", props, setCategories)
    ]);
  }

  useEffect(() => {
    refresh();
  }, [search, category, stockMode]);

  async function submitProduct(event: FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) return props.setError(explainRequired("Nombre del producto"));
    if (!form.sku.trim()) return props.setError(explainRequired("Codigo SKU"));
    if (form.price <= 0) return props.setError("No se pudo crear el producto: el precio de venta debe ser mayor a 0.");
    const body = new FormData();
    Object.entries(form).forEach(([key, value]) => body.append(key, String(value)));
    if (image) body.append("image", image);
    const ok = await mutate(
      props,
      editingProduct ? `/products/${editingProduct.id}` : "/products",
      { method: editingProduct ? "PUT" : "POST", body },
      refresh
    );
    if (ok) {
      setForm(defaultProduct);
      setImage(null);
      setEditingProduct(null);
      setModal(null);
    }
  }

  async function submitCategory(event: FormEvent) {
    event.preventDefault();
    if (!categoryForm.name.trim()) return props.setError(explainRequired("Nombre de la categoria"));
    const ok = await mutate(
      props,
      "/categories",
      { method: "POST", body: JSON.stringify(categoryForm) },
      refresh
    );
    if (ok) {
      setCategoryForm({ name: "", color: "#f59e0b" });
      setModal(null);
    }
  }

  function closeModal() {
    setModal(null);
    setEditingProduct(null);
    setForm(defaultProduct);
    setImage(null);
    setCategoryForm({ name: "", color: "#f59e0b" });
  }

  function openProductModal(product?: Product) {
    if (product) {
      setEditingProduct(product);
      setForm({
        name: product.name,
        sku: product.sku,
        description: product.description ?? "",
        category_id: product.category_id ?? "",
        price: Number(product.price),
        employee_discount_percent: Number(product.employee_discount_percent ?? 0),
        cost: Number(product.cost),
        stock: Number(product.stock),
        min_stock: Number(product.min_stock),
        origin: product.origin ?? ""
      });
    } else {
      setEditingProduct(null);
      setForm(defaultProduct);
    }
    setImage(null);
    setModal("product");
  }

  async function deleteCategory(cat: Category) {
    const productsCount = cat.products_count ?? 0;
    const message =
      productsCount > 0
        ? `La categoria "${cat.name}" tiene ${productsCount} producto(s). Si la eliminas, esos productos quedaran sin categoria.`
        : `Eliminar la categoria "${cat.name}".`;
    const confirmed = await props.confirm({
      title: "Eliminar categoria",
      message,
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      tone: "danger"
    });
    if (!confirmed) return;
    await mutate(props, `/categories/${cat.id}`, { method: "DELETE" }, refresh);
    if (category === cat.id) setCategory("");
  }

  return (
    <div className="grid-stack">
      <div className="toolbelt">
        <label className="searchbox">
          <Search size={18} />
          <input placeholder="Buscar por nombre o SKU" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Todas las categorias</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>{cat.name}</option>
          ))}
        </select>
        <select value={stockMode} onChange={(e) => setStockMode(e.target.value)}>
          <option value="">Todo el stock</option>
          <option value="low">Stock bajo</option>
          <option value="out">Agotados</option>
        </select>
      </div>
      <Panel title="Acciones de inventario">
        <div className="inventory-actions">
          <button className="primary" onClick={() => openProductModal()}><Plus size={16} /> Nuevo producto</button>
          <button className="secondary" onClick={() => setModal("category")}><Plus size={16} /> Nueva categoria</button>
        </div>
        <div className="chip-list">
          {categories.map((cat) => (
            <button
              className="chip removable"
              key={cat.id}
              onClick={() => deleteCategory(cat)}
              style={{ "--tag": cat.color } as React.CSSProperties}
              title={`Eliminar ${cat.name}`}
            >
              <span>{cat.name} · {cat.products_count ?? 0}</span>
              <Trash2 size={14} />
            </button>
          ))}
        </div>
      </Panel>
      <div className="inventory-grid">
        {products.map((product) => (
          <article className="product-card" key={product.id}>
            <div className="product-image">
              {product.image_url ? <img src={`${API_URL}${product.image_url}`} alt={product.name} /> : <Beer size={42} />}
            </div>
            <div className="product-body">
              <span className="tag" style={{ "--tag": product.category_color ?? "#f59e0b" } as React.CSSProperties}>
                {product.category_name ?? "Sin categoria"}
              </span>
              <h3>{product.name}</h3>
              <p>{product.sku} · {product.origin || "Origen libre"}</p>
              <div className="product-stats">
                <strong>{money.format(Number(product.price))}</strong>
                <span className={product.stock <= product.min_stock ? "danger" : ""}>{product.stock} uds</span>
              </div>
              <button className="secondary product-edit" onClick={() => openProductModal(product)}><Edit3 size={16} /> Editar</button>
            </div>
          </article>
        ))}
      </div>
      {modal === "product" && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-panel">
            <div className="modal-head">
              <h2>{editingProduct ? "Editar producto" : "Nuevo producto"}</h2>
              <button className="icon-button" onClick={closeModal}>
                <X size={18} />
              </button>
            </div>
            <form className="dense-form" onSubmit={submitProduct}>
            <label className="field">
              <span>Nombre del producto</span>
              <input placeholder="Ej: Pilsen lata 330 ml" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="field">
              <span>Codigo SKU</span>
              <input placeholder="Ej: PIL-330-L" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
              <small>Identificador unico para buscar y controlar inventario.</small>
            </label>
            <label className="field">
              <span>Categoria</span>
              <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                <option value="">Selecciona una categoria</option>
                {categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Origen o marca</span>
              <input placeholder="Ej: Colombia, BBC, Corona" value={form.origin} onChange={(e) => setForm({ ...form, origin: e.target.value })} />
            </label>
            <label className="field">
              <span>Precio de venta</span>
              <input type="number" min="0" step="100" placeholder="Ej: 6000" value={numberInputValue(form.price)} onChange={(e) => setForm({ ...form, price: readNumberInput(e.target.value) })} />
              <small>Valor que paga el cliente.</small>
            </label>
            <label className="field">
              <span>Descuento para consumo empleado (%)</span>
              <input type="number" min="0" max="100" step="1" placeholder="Ej: 15" value={numberInputValue(form.employee_discount_percent)} onChange={(e) => setForm({ ...form, employee_discount_percent: readNumberInput(e.target.value) })} />
              <small>Se aplica cuando el empleado cobra como credito.</small>
            </label>
            <label className="field">
              <span>Costo de compra</span>
              <input type="number" min="0" step="100" placeholder="Ej: 3500" value={numberInputValue(form.cost)} onChange={(e) => setForm({ ...form, cost: readNumberInput(e.target.value) })} />
              <small>Sirve para calcular utilidad.</small>
            </label>
            <label className="field">
              <span>Cantidad disponible</span>
              <input type="number" min="0" step="1" placeholder="Ej: 24" value={numberInputValue(form.stock)} onChange={(e) => setForm({ ...form, stock: readNumberInput(e.target.value) })} />
            </label>
            <label className="field">
              <span>Alerta de stock minimo</span>
              <input type="number" min="0" step="1" placeholder="Ej: 6" value={numberInputValue(form.min_stock)} onChange={(e) => setForm({ ...form, min_stock: readNumberInput(e.target.value) })} />
              <small>El dashboard avisa cuando llegue a este nivel.</small>
            </label>
            <label className="upload-button">
              <Upload size={16} />
              <span>{image ? image.name : "Imagen del producto"}</span>
              <input type="file" accept="image/*" onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
            </label>
              <div className="modal-actions">
                <button type="button" className="secondary" onClick={closeModal}>Cancelar</button>
                <button className="primary"><Plus size={16} /> {editingProduct ? "Guardar producto" : "Crear producto"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {modal === "category" && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-panel compact-modal">
            <div className="modal-head">
              <h2>Nueva categoria</h2>
              <button className="icon-button" onClick={closeModal}>
                <X size={18} />
              </button>
            </div>
            <form className="dense-form" onSubmit={submitCategory}>
            <label className="field">
              <span>Nombre de la categoria</span>
              <input placeholder="Ej: Nacionales, importadas, snacks" value={categoryForm.name} onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })} />
            </label>
            <label className="field color-field">
              <span>Color de etiqueta</span>
              <input type="color" value={categoryForm.color} onChange={(e) => setCategoryForm({ ...categoryForm, color: e.target.value })} />
            </label>
              <div className="modal-actions">
                <button type="button" className="secondary" onClick={closeModal}>Cancelar</button>
                <button className="primary"><Plus size={16} /> Crear categoria</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

async function mutate(props: ViewProps, path: string, options: RequestInit, after?: () => void | Promise<void>) {
  props.setLoading(true);
  props.setError("");
  props.setSuccess("");
  try {
    await api(path, options, props.token);
    await after?.();
    return true;
  } catch (err) {
    props.setError((err as Error).message);
    return false;
  } finally {
    props.setLoading(false);
  }
}

function Sales(props: ViewProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [period, setPeriod] = useState<Period>("all");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [saleDraft, setSaleDraft] = useState<SaleDraft>({
    payment_method: "cash",
    cash_received: 0,
    transfer_received: 0
  });
  const isEmployee = !props.currentUser.permissions.includes("all");

  async function refresh() {
    await Promise.all([
      loadData("/products", props, setProducts),
      loadData("/categories", props, setCategories),
      loadData(`/sales?period=${period}`, props, setSales)
    ]);
  }

  useEffect(() => {
    refresh();
  }, [period]);

  const selected = useMemo(
    () => products.filter((p) => cart[p.id]).map((p) => ({ ...p, quantity: cart[p.id] })),
    [products, cart]
  );
  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((product) => {
      const matchesSearch =
        !term ||
        product.name.toLowerCase().includes(term) ||
        product.sku.toLowerCase().includes(term);
      const matchesCategory = !category || product.category_id === category;
      return matchesSearch && matchesCategory;
    });
  }, [products, search, category]);
  function saleUnitPrice(product: Product) {
    return saleDraft.payment_method === "credit"
      ? Number(product.price) * (1 - Number(product.employee_discount_percent ?? 0) / 100)
      : Number(product.price);
  }

  const total = selected.reduce((sum, p) => {
    const unitPrice =
      saleDraft.payment_method === "credit"
        ? Number(p.price) * (1 - Number(p.employee_discount_percent ?? 0) / 100)
        : Number(p.price);
    return sum + unitPrice * p.quantity;
  }, 0);
  const cashNeeded = saleDraft.payment_method === "flexible" ? Math.max(total - saleDraft.transfer_received, 0) : total;
  const transferNeeded = saleDraft.payment_method === "flexible" ? Math.max(total - saleDraft.cash_received, 0) : total;
  const change = saleDraft.payment_method === "cash" || saleDraft.payment_method === "flexible" ? Math.max(saleDraft.cash_received - cashNeeded, 0) : 0;
  const paidTotal =
    saleDraft.payment_method === "credit"
      ? total
      : saleDraft.payment_method === "cash"
      ? saleDraft.cash_received
      : saleDraft.payment_method === "transfer"
        ? saleDraft.transfer_received
        : saleDraft.cash_received + saleDraft.transfer_received;

  function updateQuantity(product: Product, quantity: number) {
    const nextQuantity = Math.max(0, Math.min(product.stock, quantity));
    const next = { ...cart };
    if (nextQuantity === 0) delete next[product.id];
    else next[product.id] = nextQuantity;
    setCart(next);
  }

  function openCheckout() {
    if (!selected.length) return props.setError("Agrega al menos un producto para cobrar la venta.");
    setSaleDraft({
      payment_method: "cash",
      cash_received: total,
      transfer_received: 0
    });
    setCheckoutOpen(true);
  }

  async function closeSale() {
    if (!selected.length) return props.setError("No se pudo confirmar la venta: el carrito esta vacio.");
    if (saleDraft.payment_method === "cash" && saleDraft.cash_received < total) {
      return props.setError("No se pudo confirmar la venta: el efectivo recibido es menor al total.");
    }
    if (saleDraft.payment_method === "transfer" && saleDraft.transfer_received < total) {
      return props.setError("No se pudo confirmar la venta: la transferencia es menor al total.");
    }
    if ((saleDraft.payment_method === "transfer" || saleDraft.payment_method === "flexible") && saleDraft.transfer_received > total) {
      return props.setError("No se pudo confirmar la venta: la transferencia no puede superar el total.");
    }
    if (saleDraft.payment_method === "flexible" && paidTotal < total) {
      return props.setError("No se pudo confirmar la venta: la suma de efectivo y transferencia es menor al total.");
    }
    if (saleDraft.payment_method === "credit" && !isEmployee) {
      return props.setError("No se pudo confirmar la venta: el credito solo aplica para empleados.");
    }

    const ok = await mutate(
      props,
      "/sales",
      {
        method: "POST",
        body: JSON.stringify({
          payment_method: saleDraft.payment_method,
          cash_received: saleDraft.payment_method === "cash" || saleDraft.payment_method === "flexible" ? saleDraft.cash_received : null,
          transfer_received: saleDraft.payment_method === "transfer" || saleDraft.payment_method === "flexible" ? saleDraft.transfer_received : null,
          items: selected.map((p) => ({ product_id: p.id, quantity: p.quantity }))
        })
      },
      refresh
    );
    if (ok) {
      setCart({});
      setCheckoutOpen(false);
      props.setSuccess(`Venta registrada por ${money.format(total)}. Pago: ${paymentLabel(saleDraft.payment_method)}. ${change > 0 ? `Cambio: ${money.format(change)}.` : ""}`);
    }
  }

  return (
    <>
      <div className="two-col wide-left">
        <Panel title="Venta rapida">
          <PeriodFilter value={period} onChange={setPeriod} />
          <div className="toolbelt sales-toolbelt">
            <label className="searchbox">
              <Search size={18} />
              <input placeholder="Buscar producto por nombre o SKU" value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Todas las categorias</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>
          <div className="sale-products">
            {filteredProducts.map((product) => (
              <button
                key={product.id}
                onClick={() => updateQuantity(product, (cart[product.id] ?? 0) + 1)}
                disabled={product.stock <= 0 || (cart[product.id] ?? 0) >= product.stock}
              >
                <ProductThumb product={product} />
                <span>{product.name}</span>
                <small>{money.format(Number(product.price))} · {product.stock} uds</small>
                {!!cart[product.id] && <strong>{cart[product.id]} en carrito</strong>}
              </button>
            ))}
            {filteredProducts.length === 0 && <p className="empty-state">No hay productos que coincidan con el filtro.</p>}
          </div>
        </Panel>
        <Panel title="Carrito y ultimas ventas">
          <div className="cart-list">
            {selected.length === 0 && <p className="empty-state">Selecciona productos para iniciar la venta.</p>}
            {selected.map((item) => (
              <div className="cart-row" key={item.id}>
                <ProductThumb product={item} />
                <div>
                  <strong>{item.name}</strong>
                  <small>{money.format(saleUnitPrice(item))} por unidad</small>
                </div>
                <div className="quantity-control">
                  <button className="icon-button" onClick={() => updateQuantity(item, item.quantity - 1)} title="Restar unidad">
                    <Minus size={16} />
                  </button>
                  <input
                    type="number"
                    min="1"
                    max={item.stock}
                    value={item.quantity}
                    onChange={(event) => updateQuantity(item, readNumberInput(event.target.value))}
                  />
                  <button className="icon-button" onClick={() => updateQuantity(item, item.quantity + 1)} disabled={item.quantity >= item.stock} title="Sumar unidad">
                    <Plus size={16} />
                  </button>
                </div>
                <strong>{money.format(saleUnitPrice(item) * item.quantity)}</strong>
              </div>
            ))}
          </div>
          <div className="checkout">
            <strong>{money.format(total)}</strong>
            <button className="primary" disabled={!selected.length} onClick={openCheckout}>Cobrar</button>
          </div>
          <hr />
          <div className="scroll-list compact-list">
            {sales.map((sale) => (
              <Row
                key={sale.id}
                left={`${new Date(sale.created_at).toLocaleDateString()} · ${sale.user_name ?? "Venta"} · ${paymentLabel(sale.payment_method)}`}
                right={money.format(Number(sale.total))}
              />
            ))}
          </div>
        </Panel>
      </div>
      {checkoutOpen && (
        <SaleCheckoutModal
          cart={selected}
          isEmployee={isEmployee}
          unitPrice={saleUnitPrice}
          draft={saleDraft}
          total={total}
          change={change}
          paidTotal={paidTotal}
          cashNeeded={cashNeeded}
          transferNeeded={transferNeeded}
          setDraft={setSaleDraft}
          updateQuantity={updateQuantity}
          onCancel={() => setCheckoutOpen(false)}
          onConfirm={closeSale}
        />
      )}
    </>
  );
}

function SaleCheckoutModal({
  cart,
  isEmployee,
  unitPrice,
  draft,
  total,
  change,
  paidTotal,
  cashNeeded,
  transferNeeded,
  setDraft,
  updateQuantity,
  onCancel,
  onConfirm
}: {
  cart: Array<Product & { quantity: number }>;
  isEmployee: boolean;
  unitPrice: (product: Product) => number;
  draft: SaleDraft;
  total: number;
  change: number;
  paidTotal: number;
  cashNeeded: number;
  transferNeeded: number;
  setDraft: (draft: SaleDraft) => void;
  updateQuantity: (product: Product, quantity: number) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const transferExceedsTotal =
    (draft.payment_method === "transfer" || draft.payment_method === "flexible") && draft.transfer_received > total;
  const saleIsShort = paidTotal < total;
  const saleIsInvalid = saleIsShort || transferExceedsTotal;
  const showCash = draft.payment_method === "cash" || draft.payment_method === "flexible";
  const showTransfer = draft.payment_method === "transfer" || draft.payment_method === "flexible";

  function changePaymentMethod(method: SalePaymentMethod) {
    setDraft({
      payment_method: method,
      cash_received: method === "transfer" || method === "credit" ? 0 : method === "cash" ? total : draft.cash_received,
      transfer_received: method === "cash" || method === "credit" ? 0 : method === "transfer" ? total : draft.transfer_received
    });
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-panel sale-modal">
        <div className="modal-head">
          <h2>Confirmar venta</h2>
          <button className="icon-button" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>

        <div className="sale-review-list">
          {cart.map((item) => (
            <div className="cart-row review" key={item.id}>
              <ProductThumb product={item} />
              <div>
                <strong>{item.name}</strong>
                <small>
                  {money.format(unitPrice(item))} por unidad
                  {draft.payment_method === "credit" && Number(item.employee_discount_percent ?? 0) > 0
                    ? ` · ${Number(item.employee_discount_percent)}% desc.`
                    : ""}
                </small>
              </div>
              <div className="quantity-control">
                <button className="icon-button" onClick={() => updateQuantity(item, item.quantity - 1)} title="Restar unidad">
                  <Minus size={16} />
                </button>
                <input
                  type="number"
                  min="1"
                  max={item.stock}
                  value={item.quantity}
                  onChange={(event) => updateQuantity(item, readNumberInput(event.target.value))}
                />
                <button className="icon-button" onClick={() => updateQuantity(item, item.quantity + 1)} disabled={item.quantity >= item.stock} title="Sumar unidad">
                  <Plus size={16} />
                </button>
              </div>
              <strong>{money.format(unitPrice(item) * item.quantity)}</strong>
            </div>
          ))}
        </div>

        <div className="checkout-form">
          <label className="field">
            <span>Forma de pago</span>
            <select value={draft.payment_method} onChange={(event) => changePaymentMethod(event.target.value as SalePaymentMethod)}>
              <option value="cash">Efectivo</option>
              <option value="transfer">Transferencia</option>
              <option value="flexible">Flexible</option>
              {isEmployee && <option value="credit">Credito empleado</option>}
            </select>
          </label>
          {showTransfer && (
            <label className="field">
              <span>Valor por transferencia</span>
              <input
                type="number"
                min="0"
                step="100"
                placeholder="Ej: 20000"
                value={numberInputValue(draft.transfer_received)}
                onChange={(event) => setDraft({ ...draft, transfer_received: readNumberInput(event.target.value) })}
              />
              <small>
                {transferExceedsTotal
                  ? "La transferencia no puede superar el total."
                  : draft.payment_method === "transfer"
                    ? "Valor transferido por el cliente."
                    : `Efectivo requerido con esta transferencia: ${money.format(cashNeeded)}`}
              </small>
            </label>
          )}
          {showCash && (
            <label className="field">
              <span>Valor en efectivo</span>
              <input
                type="number"
                min="0"
                step="100"
                placeholder="Ej: 50000"
                value={numberInputValue(draft.cash_received)}
                onChange={(event) => setDraft({ ...draft, cash_received: readNumberInput(event.target.value) })}
              />
              <small>
                {draft.payment_method === "flexible"
                  ? `Transferencia requerida con este efectivo: ${money.format(transferNeeded)}${change > 0 && !saleIsInvalid ? ` · Cambio ${money.format(change)}` : ""}`
                  : saleIsInvalid
                    ? "Corrige los valores de pago para calcular el cambio."
                    : `Cambio a devolver: ${money.format(change)}`}
              </small>
            </label>
          )}
        </div>

        <div className="sale-summary">
          <span>Total</span>
          <strong>{money.format(total)}</strong>
          <small>
            Pago {paymentLabel(draft.payment_method)}
            {showCash ? ` · Efectivo ${money.format(draft.cash_received)}` : ""}
            {showTransfer ? ` · Transferencia ${money.format(draft.transfer_received)}` : ""}
            {saleIsShort ? ` · Faltan ${money.format(total - paidTotal)}` : ""}
            {showCash && !saleIsInvalid ? ` · Cambio ${money.format(change)}` : ""}
            {draft.payment_method === "credit" ? " · Se descuenta como consumo del empleado" : ""}
          </small>
        </div>

        <div className="confirm-actions">
          <button className="secondary" onClick={onCancel}>Editar despues</button>
          <button className="primary" onClick={onConfirm} disabled={!cart.length || saleIsInvalid}>Confirmar venta</button>
        </div>
      </div>
    </div>
  );
}

function ProductThumb({ product }: { product: Product }) {
  return (
    <div className="sale-product-thumb">
      {product.image_url ? <img src={`${API_URL}${product.image_url}`} alt={product.name} /> : <Beer size={22} />}
    </div>
  );
}

function Accounting(props: ViewProps) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [expenseTypes, setExpenseTypes] = useState<ExpenseType[]>([]);
  const [credits, setCredits] = useState<EmployeeCredit[]>([]);
  const [cashRegister, setCashRegister] = useState<CashRegisterInfo | null>(null);
  const [period, setPeriod] = useState<Period>("all");
  const [expense, setExpense] = useState({ concept: "", amount: 0, type_id: "" });
  const [typeForm, setTypeForm] = useState({ name: "", color: "#38bdf8" });
  const [cashModal, setCashModal] = useState<"base" | "close" | null>(null);
  const [cashAmount, setCashAmount] = useState(0);
  const isAdmin = props.currentUser.permissions.includes("all");

  async function refresh() {
    props.setLoading(true);
    props.setError("");
    try {
      const [dashboardData, typesData, creditsData, cashData] = await Promise.all([
        api<Dashboard>(`/accounting/dashboard?period=${period}`, {}, props.token),
        api<ExpenseType[]>("/accounting/expense-types", {}, props.token),
        api<EmployeeCredit[]>(`/accounting/employee-credits?period=${period}`, {}, props.token),
        api<CashRegisterInfo>("/accounting/cash-register/today", {}, props.token)
      ]);
      setDashboard(dashboardData);
      setExpenseTypes(typesData);
      setCredits(creditsData);
      setCashRegister(cashData);
      setExpense((current) => ({ ...current, type_id: current.type_id || typesData[0]?.id || "" }));
    } catch (err) {
      props.setError((err as Error).message);
    } finally {
      props.setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [period]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!expense.concept.trim()) return props.setError(explainRequired("Concepto del egreso"));
    if (expense.amount <= 0) return props.setError("No se pudo guardar el egreso: el valor debe ser mayor a 0.");
    if (!expense.type_id) return props.setError("No se pudo guardar el egreso: selecciona un tipo de egreso.");
    const ok = await mutate(
      props,
      "/accounting/expenses",
      { method: "POST", body: JSON.stringify(expense) },
      refresh
    );
    if (ok) setExpense({ concept: "", amount: 0, type_id: expenseTypes[0]?.id ?? "" });
  }

  async function submitType(event: FormEvent) {
    event.preventDefault();
    if (!typeForm.name.trim()) return props.setError(explainRequired("Nombre del tipo de egreso"));
    const ok = await mutate(
      props,
      "/accounting/expense-types",
      { method: "POST", body: JSON.stringify(typeForm) },
      refresh
    );
    if (ok) setTypeForm({ name: "", color: "#38bdf8" });
  }

  async function deleteType(type: ExpenseType) {
    const count = type.expenses_count ?? 0;
    const message =
      count > 0
        ? `El tipo "${type.name}" tiene ${count} egreso(s). Si lo eliminas, esos egresos quedaran sin tipo dinamico.`
        : `Eliminar el tipo de egreso "${type.name}".`;
    const confirmed = await props.confirm({
      title: "Eliminar tipo de egreso",
      message,
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      tone: "danger"
    });
    if (!confirmed) return;
    await mutate(props, `/accounting/expense-types/${type.id}`, { method: "DELETE" }, refresh);
    if (expense.type_id === type.id) setExpense((current) => ({ ...current, type_id: "" }));
  }

  async function payCredit(credit: EmployeeCredit) {
    const confirmed = await props.confirm({
      title: "Paz y salvo",
      message: `Marcar como pagado el credito de ${credit.user_name} por ${money.format(Number(credit.amount))}. Este valor entrara a ingresos.`,
      confirmText: "Paz y salvo",
      cancelText: "Cancelar"
    });
    if (!confirmed) return;
    await mutate(props, `/accounting/employee-credits/${credit.id}/pay`, { method: "POST" }, refresh);
  }

  function openCashModal(next: "base" | "close") {
    setCashModal(next);
    setCashAmount(next === "base" ? Number(cashRegister?.summary.base_amount ?? 0) : Number(cashRegister?.summary.expected_cash ?? 0));
  }

  async function submitCash(event: FormEvent) {
    event.preventDefault();
    if (!cashModal) return;
    const path = cashModal === "base" ? "/accounting/cash-register/base" : "/accounting/cash-register/close";
    const body = cashModal === "base" ? { base_amount: cashAmount } : { closing_amount: cashAmount };
    const ok = await mutate(props, path, { method: "POST", body: JSON.stringify(body) }, refresh);
    if (ok) setCashModal(null);
  }

  return (
    <div className="accounting-layout">
      <div className="accounting-filter">
        <PeriodFilter value={period} onChange={setPeriod} />
      </div>
      <Panel title="Caja diaria">
        <div className="cash-register-grid">
          <Metric label="Base del dia" value={money.format(Number(cashRegister?.summary.base_amount ?? 0))} />
          <Metric label="Efectivo esperado" value={money.format(Number(cashRegister?.summary.expected_cash ?? 0))} tone="gold" />
          <Metric label="Creditos pendientes" value={money.format(Number(cashRegister?.summary.pending_credits ?? 0))} />
          <Metric
            label="Descuadre"
            value={money.format(Number(cashRegister?.register?.discrepancy ?? cashRegister?.summary.discrepancy ?? 0))}
            tone={Number(cashRegister?.register?.discrepancy ?? 0) === 0 ? "" : "danger-metric"}
          />
        </div>
        <div className="cash-breakdown">
          <span>Ventas efectivo: {money.format(Number(cashRegister?.summary.cash_sales ?? 0))}</span>
          <span>Creditos pagados: {money.format(Number(cashRegister?.summary.paid_credits ?? 0))}</span>
          <span>Egresos: {money.format(Number(cashRegister?.summary.expenses ?? 0))}</span>
          {cashRegister?.register?.closed_at && <span>Cerrada: {new Date(cashRegister.register.closed_at).toLocaleString()}</span>}
        </div>
        <div className="section-actions">
          {isAdmin && <button className="secondary" onClick={() => openCashModal("base")}>Base de caja</button>}
          <button className="primary" onClick={() => openCashModal("close")}>Cierre de caja</button>
        </div>
      </Panel>
      <Panel title="Registrar egreso">
        <form className="dense-form" onSubmit={submit}>
          <label className="field">
            <span>Concepto del egreso</span>
            <input placeholder="Ej: compra a proveedor" value={expense.concept} onChange={(e) => setExpense({ ...expense, concept: e.target.value })} />
          </label>
          <label className="field">
            <span>Valor del egreso</span>
            <input type="number" min="0" step="100" placeholder="Ej: 25000" value={numberInputValue(expense.amount)} onChange={(e) => setExpense({ ...expense, amount: readNumberInput(e.target.value) })} />
          </label>
          <label className="field">
            <span>Tipo de egreso</span>
            <select value={expense.type_id} onChange={(e) => setExpense({ ...expense, type_id: e.target.value })}>
              <option value="">Selecciona un tipo</option>
              {expenseTypes.map((type) => (
                <option key={type.id} value={type.id}>{type.name}</option>
              ))}
            </select>
          </label>
          <button className="primary">Guardar egreso</button>
        </form>
      </Panel>
      <Panel title="Tipos de egreso">
        <form className="dense-form" onSubmit={submitType}>
          <label className="field">
            <span>Nombre del tipo</span>
            <input placeholder="Ej: Servicios, renta, proveedores" value={typeForm.name} onChange={(e) => setTypeForm({ ...typeForm, name: e.target.value })} />
          </label>
          <label className="field color-field">
            <span>Color de etiqueta</span>
            <input type="color" value={typeForm.color} onChange={(e) => setTypeForm({ ...typeForm, color: e.target.value })} />
          </label>
          <button className="primary"><Plus size={16} /> Crear tipo</button>
        </form>
        <div className="chip-list">
          {expenseTypes.map((type) => (
            <button
              className="chip removable"
              key={type.id}
              onClick={() => deleteType(type)}
              style={{ "--tag": type.color } as React.CSSProperties}
              title={`Eliminar ${type.name}`}
            >
              <span>{type.name} · {type.expenses_count ?? 0}</span>
              <Trash2 size={14} />
            </button>
          ))}
        </div>
      </Panel>
      <div className="accounting-books">
        <Panel title="Libro de caja">
          <div className="scroll-list cashbook-list">
            {dashboard?.moneyFlow.map((flow, index) => (
              <Row key={index} left={`${flow.type} · ${flow.label}`} right={money.format(flow.amount)} />
            ))}
          </div>
        </Panel>
        <Panel title="Creditos de empleados">
          <div className="scroll-list cashbook-list">
            {credits.length === 0 && <Empty title="Sin creditos en este periodo" compact />}
            {credits.map((credit) => (
              <div className="credit-row" key={credit.id}>
                <div>
                  <strong>{credit.user_name}</strong>
                  <small>
                    {new Date(credit.created_at).toLocaleDateString()} · {credit.status === "paid" ? "Pagado" : "Pendiente"}
                  </small>
                </div>
                <strong>{money.format(Number(credit.amount))}</strong>
                {credit.status === "pending" && isAdmin ? (
                  <button className="primary" onClick={() => payCredit(credit)}>Paz y salvo</button>
                ) : credit.status === "pending" ? (
                  <span className="status">Pendiente</span>
                ) : (
                  <span className="status active-status">Pagado</span>
                )}
              </div>
            ))}
          </div>
        </Panel>
      </div>
      {cashModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="confirm-panel">
            <div className="modal-head">
              <h2>{cashModal === "base" ? "Base de caja" : "Cierre de caja"}</h2>
              <button className="icon-button" onClick={() => setCashModal(null)}><X size={18} /></button>
            </div>
            <form className="grid-stack" onSubmit={submitCash}>
              <label className="field">
                <span>{cashModal === "base" ? "Base que queda para el dia" : "Efectivo contado al cierre"}</span>
                <input type="number" min="0" step="100" value={numberInputValue(cashAmount)} onChange={(e) => setCashAmount(readNumberInput(e.target.value))} />
                {cashModal === "close" && <small>Esperado: {money.format(Number(cashRegister?.summary.expected_cash ?? 0))}</small>}
              </label>
              <div className="confirm-actions">
                <button type="button" className="secondary" onClick={() => setCashModal(null)}>Cancelar</button>
                <button className="primary">{cashModal === "base" ? "Guardar base" : "Cerrar caja"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function UsersView(props: ViewProps) {
  type UserRecord = {
    id: string;
    name: string;
    email: string;
    role_id: string;
    role: string;
    employee_credit: number;
    hourly_rate: number;
    is_active: boolean;
    created_at: string;
  };
  type UserForm = {
    name: string;
    email: string;
    password: string;
    confirmPassword: string;
    role_id: string;
    employee_credit: number;
    hourly_rate: number;
    is_active: boolean;
  };

  const emptyForm: UserForm = {
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    role_id: "",
    employee_credit: 0,
    hourly_rate: 0,
    is_active: true
  };

  const [users, setUsers] = useState<UserRecord[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [modal, setModal] = useState<"create" | "edit" | "detail" | null>(null);
  const [selected, setSelected] = useState<UserRecord | null>(null);
  const isAdmin = props.currentUser.permissions.includes("all") || props.currentUser.role === "Administrador";

  async function refresh() {
    const rolesData = await api<any[]>("/users/roles", {}, props.token);
    setRoles(rolesData);
    setForm((current) => ({ ...current, role_id: current.role_id || rolesData[0]?.id || "" }));
    setUsers(await api<UserRecord[]>("/users", {}, props.token));
  }

  useEffect(() => {
    props.setLoading(true);
    refresh().catch((err) => props.setError(err.message)).finally(() => props.setLoading(false));
  }, []);

  function openCreate() {
    setSelected(null);
    setForm({ ...emptyForm, role_id: roles[0]?.id ?? "" });
    setModal("create");
  }

  function openDetail(user: UserRecord) {
    setSelected(user);
    setModal("detail");
  }

  function openEdit(user: UserRecord) {
    setSelected(user);
    setForm({
      name: user.name,
      email: user.email,
      password: "",
      confirmPassword: "",
      role_id: user.role_id,
      employee_credit: Number(user.employee_credit),
      hourly_rate: Number(user.hourly_rate),
      is_active: user.is_active
    });
    setModal("edit");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) return props.setError(explainRequired("Nombre"));
    if (!form.email.trim()) return props.setError(explainRequired("Usuario de acceso"));
    if (modal === "create" && form.password.length < 8) return props.setError("No se pudo crear el usuario: el password debe tener minimo 8 caracteres.");
    if (modal === "edit" && form.password && form.password.length < 8) return props.setError("No se pudo editar el usuario: el nuevo password debe tener minimo 8 caracteres.");
    if (form.password && form.password !== form.confirmPassword) return props.setError("No se pudo guardar el usuario: las contraseñas no coinciden.");
    if (!form.role_id) return props.setError("No se pudo guardar el usuario: selecciona un rol.");

    const payload =
      modal === "create"
        ? {
            name: form.name,
            email: form.email,
            password: form.password,
            role_id: form.role_id,
            employee_credit: 0,
            hourly_rate: form.hourly_rate,
            is_active: form.is_active
          }
        : {
            name: form.name,
            email: form.email,
            role_id: form.role_id,
            employee_credit: 0,
            hourly_rate: form.hourly_rate,
            is_active: form.is_active
          };
    const path = modal === "edit" && selected ? `/users/${selected.id}` : "/users";
    const method = modal === "edit" ? "PUT" : "POST";
    props.setLoading(true);
    props.setError("");
    props.setSuccess("");
    try {
      await api(
        path,
        { method, body: JSON.stringify(payload) },
        props.token
      );
      if (modal === "edit" && selected && form.password) {
        await api(
          `/users/${selected.id}/password`,
          { method: "PATCH", body: JSON.stringify({ password: form.password }) },
          props.token
        );
      }
      await refresh();
      props.setSuccess(
        modal === "create"
          ? "Usuario creado correctamente."
          : form.password
            ? "Usuario y contraseña actualizados correctamente."
            : "Usuario actualizado correctamente."
      );
      setModal(null);
      setSelected(null);
      setForm({ ...emptyForm, role_id: roles[0]?.id ?? "" });
    } catch (err) {
      props.setError((err as Error).message);
    } finally {
      props.setLoading(false);
    }
  }

  async function deleteUser(user: UserRecord) {
    if (user.id === props.currentUser.id) {
      props.setError("No puedes eliminar tu propio usuario mientras tienes la sesion activa.");
      return;
    }
    const confirmed = await props.confirm({
      title: "Eliminar usuario",
      message: `Eliminar el usuario "${user.name}". Su acceso quedara desactivado.`,
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      tone: "danger"
    });
    if (!confirmed) return;
    await mutate(props, `/users/${user.id}`, { method: "DELETE" }, refresh);
  }

  if (!isAdmin) {
    return <Empty title="Solo el rol Administrador puede administrar usuarios." />;
  }

  return (
    <div className="grid-stack">
      <div className="section-actions">
        <button className="primary" onClick={openCreate}>
          <UserPlus size={17} />
          Nuevo usuario
        </button>
      </div>
      <Panel title="Equipo">
        <div className="user-table">
          <div className="user-row user-head">
            <span>Usuario</span>
            <span>Rol</span>
            <span>Hora</span>
            <span>Estado</span>
            <span>Acciones</span>
          </div>
          {users.map((user) => (
            <div className="user-row" key={user.id}>
              <div>
                <strong>{user.name}</strong>
                <small>{user.email}</small>
              </div>
              <span>{user.role}</span>
              <strong>{money.format(Number(user.hourly_rate))}</strong>
              <span className={user.is_active ? "status active-status" : "status"}>{user.is_active ? "Activo" : "Inactivo"}</span>
              <div className="quick-actions">
                <button className="icon-button" title="Ver detalles" onClick={() => openDetail(user)}><Eye size={17} /></button>
                <button className="icon-button" title="Editar usuario" onClick={() => openEdit(user)}><Edit3 size={17} /></button>
                <button className="icon-button danger-action" title="Eliminar usuario" onClick={() => deleteUser(user)}><Trash2 size={17} /></button>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {modal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-panel">
            <div className="modal-head">
              <h2>{modal === "create" ? "Crear usuario" : modal === "edit" ? "Editar usuario" : "Detalle del usuario"}</h2>
              <button className="icon-button" onClick={() => setModal(null)}><X size={18} /></button>
            </div>
            {modal === "detail" && selected ? (
              <div className="detail-grid">
                <Row left="Nombre" right={selected.name} />
                <Row left="Usuario de acceso" right={selected.email} />
                <Row left="Rol" right={selected.role} />
                <Row left="Precio por hora" right={money.format(Number(selected.hourly_rate))} />
                <Row left="Estado" right={selected.is_active ? "Activo" : "Inactivo"} />
                <Row left="Creado" right={new Date(selected.created_at).toLocaleDateString()} />
                <div className="modal-actions">
                  <button className="primary" onClick={() => openEdit(selected)}><Edit3 size={16} /> Editar</button>
                </div>
              </div>
            ) : (
              <form className="dense-form" onSubmit={submit}>
                <label className="field">
                  <span>Nombre del usuario</span>
                  <input placeholder="Ej: Laura Gomez" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </label>
                <label className="field">
                  <span>Usuario de acceso</span>
                  <input placeholder="Ej: laura.turno" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </label>
                <label className="field">
                  <span>{modal === "edit" ? "Nuevo password opcional" : "Password inicial"}</span>
                  <PasswordInput
                    placeholder="Minimo 8 caracteres"
                    value={form.password}
                    onChange={(password) => setForm({ ...form, password })}
                  />
                </label>
                <label className="field">
                  <span>{modal === "edit" ? "Confirmar nuevo password" : "Confirmar password"}</span>
                  <PasswordInput
                    placeholder={modal === "edit" ? "Repite solo si cambias password" : "Repite la contraseña"}
                    value={form.confirmPassword}
                    onChange={(confirmPassword) => setForm({ ...form, confirmPassword })}
                  />
                </label>
                <label className="field">
                  <span>Rol del usuario</span>
                  <select value={form.role_id} onChange={(e) => setForm({ ...form, role_id: e.target.value })}>
                    <option value="">Selecciona un rol</option>
                    {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Precio por hora trabajada</span>
                  <input type="number" min="0" step="100" placeholder="Ej: 8000" value={numberInputValue(form.hourly_rate)} onChange={(e) => setForm({ ...form, hourly_rate: readNumberInput(e.target.value) })} />
                  <small>Se copia a cada jornada cuando el empleado marca inicio.</small>
                </label>
                <label className="field toggle-field">
                  <span>Usuario activo</span>
                  <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                </label>
                <div className="modal-actions">
                  <button type="button" className="secondary" onClick={() => setModal(null)}>Cancelar</button>
                  <button className="primary">{modal === "edit" ? "Guardar cambios" : "Crear usuario"}</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Shifts(props: ViewProps) {
  const [active, setActive] = useState<any | null>(null);
  const [shifts, setShifts] = useState<any[]>([]);
  const [payroll, setPayroll] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const isAdmin = props.currentUser.permissions.includes("all");

  async function refresh() {
    const [activeData, shiftsData] = await Promise.all([
      api("/shifts/active", {}, props.token),
      api<any[]>("/shifts", {}, props.token)
    ]);
    setActive(activeData);
    setShifts(shiftsData);
    if (isAdmin) {
      const [payrollData, paymentsData] = await Promise.all([
        api<any[]>("/shifts/payroll/summary", {}, props.token),
        api<any[]>("/shifts/payroll/payments", {}, props.token)
      ]);
      setPayroll(payrollData);
      setPayments(paymentsData);
    }
  }

  useEffect(() => {
    props.setLoading(true);
    refresh().catch((err) => props.setError(err.message)).finally(() => props.setLoading(false));
  }, []);

  async function payEmployee(item: any) {
    const confirmed = await props.confirm({
      title: "Pagar horas",
      message: `Pagar ${Number(item.hours).toFixed(2)} horas a ${item.user_name} por ${money.format(Number(item.amount))}. El historial pendiente quedara en paz y salvo.`,
      confirmText: "Pagar",
      cancelText: "Cancelar"
    });
    if (!confirmed) return;
    await mutate(props, `/shifts/payroll/${item.user_id}/pay`, { method: "POST" }, refresh);
  }

  return (
    <div className="grid-stack">
      <div className="two-col">
      <Panel title="Control de jornada">
        <div className="shift-control">
          <Clock3 size={42} />
          <strong>{active ? "Jornada activa" : "Sin jornada activa"}</strong>
          <small>{active ? `${new Date(active.started_at).toLocaleString()} · ${money.format(Number(active.hourly_rate ?? 0))}/h` : "Marca inicio para contar horas"}</small>
          <button className="primary" onClick={() => mutate(props, active ? "/shifts/end" : "/shifts/start", { method: "POST" }, refresh)}>
            {active ? "Finalizar jornada" : "Iniciar jornada"}
          </button>
        </div>
      </Panel>
      <Panel title="Historial de horas">
        <div className="scroll-list compact-list">
          {shifts.length === 0 && <Empty title="Sin horas pendientes" compact />}
          {shifts.map((shift) => (
            <Row
              key={shift.id}
              left={`${shift.user_name} · ${new Date(shift.started_at).toLocaleDateString()}`}
              right={`${Number(shift.hours ?? 0).toFixed(2)} h · ${money.format(Number(shift.earned ?? 0))}`}
            />
          ))}
        </div>
      </Panel>
      </div>
      {isAdmin && (
        <div className="two-col">
          <Panel title="Horas por trabajador">
            <div className="scroll-list compact-list">
              {payroll.length === 0 && <Empty title="Sin horas pendientes por pagar" compact />}
              {payroll.map((item) => (
                <div className="credit-row" key={item.user_id}>
                  <div>
                    <strong>{item.user_name}</strong>
                    <small>{Number(item.hours).toFixed(2)} h · {item.shifts_count} jornada(s)</small>
                  </div>
                  <strong>{money.format(Number(item.amount))}</strong>
                  <button className="primary" onClick={() => payEmployee(item)}>Pagar</button>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Paz y salvo de horas">
            <div className="scroll-list compact-list">
              {payments.length === 0 && <Empty title="Sin pagos registrados" compact />}
              {payments.map((payment) => (
                <Row
                  key={payment.id}
                  left={`${payment.user_name} · ${new Date(payment.paid_at).toLocaleString()}`}
                  right={`${Number(payment.hours).toFixed(2)} h · ${money.format(Number(payment.amount))}`}
                />
              ))}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}

function Loader() {
  return (
    <div className="loader">
      <span />
      <p>Sincronizando barriles digitales...</p>
    </div>
  );
}

function PasswordInput({
  value,
  onChange,
  placeholder
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-control">
      <input
        type={visible ? "text" : "password"}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setVisible(!visible)}
        title={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
      >
        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}

function ConfirmModal({
  options,
  onCancel,
  onConfirm
}: {
  options: ConfirmOptions;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="confirm-panel">
        <div className="modal-head">
          <h2>{options.title}</h2>
          <button className="icon-button" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>
        <p>{options.message}</p>
        <div className="confirm-actions">
          <button className="secondary" onClick={onCancel}>
            {options.cancelText ?? "Cancelar"}
          </button>
          <button className={options.tone === "danger" ? "primary danger-confirm" : "primary"} onClick={onConfirm}>
            {options.confirmText ?? "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function WorkNoticeModal({
  type,
  onConfirm,
  onClose
}: {
  type: "start";
  onConfirm: () => void;
  onClose?: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="confirm-panel">
        <div className="modal-head">
          <h2>Inicia tu jornada</h2>
          {onClose && (
            <button className="icon-button" onClick={onClose}>
              <X size={18} />
            </button>
          )}
        </div>
        <p>Antes de trabajar en ventas debes marcar el inicio de tu jornada laboral.</p>
        <div className="confirm-actions">
          <button className="primary" onClick={onConfirm}>
            Ir a jornadas
          </button>
        </div>
      </div>
    </div>
  );
}

function NoticeModal({
  kind,
  title,
  message,
  onClose
}: {
  kind: "success" | "error";
  title: string;
  message: string;
  onClose: () => void;
}) {
  const link = message.match(/https?:\/\/\S+/)?.[0];
  const cleanMessage = link ? message.replace(link, "").trim() : message;

  async function copyLink() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
  }

  return (
    <div className="modal-backdrop notice-backdrop" role="dialog" aria-modal="true">
      <div className={`notice-panel ${kind}`}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <p>{cleanMessage}</p>
        {link && (
          <div className="invite-link-box">
            <input value={link} readOnly />
            <button className="secondary" onClick={copyLink}>Copiar link</button>
          </div>
        )}
        <div className="confirm-actions">
          <button className="primary" onClick={onClose}>Entendido</button>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className={`metric ${tone ?? ""}`}>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Row({ left, right }: { left: string; right: string }) {
  return (
    <div className="row">
      <span>{left}</span>
      <strong>{right}</strong>
    </div>
  );
}

function Empty({ title, compact }: { title: string; compact?: boolean }) {
  return <div className={compact ? "empty compact" : "empty"}>{title}</div>;
}
