import React, { useState } from "react";
import { z } from "zod";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const addressSchema = z.object({
  label: z.string().min(2).max(40),
  fullName: z.string().min(2).max(120),
  cedula: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().min(7).max(20).optional(),
  department: z.string().min(2).max(60),
  city: z.string().min(2).max(60),
  address: z.string().min(5).max(200),
  reference: z.string().max(300).optional(),
});

export type AddressFormValues = z.infer<typeof addressSchema>;

export default function AddressForm({
  initial,
  onCancel,
  onSave,
}: {
  initial?: Partial<AddressFormValues>;
  onCancel?: () => void;
  onSave: (values: AddressFormValues) => Promise<void> | void;
}) {
  const [values, setValues] = useState<AddressFormValues>({
    label: initial?.label ?? "Casa",
    fullName: initial?.fullName ?? "",
    cedula: initial?.cedula ?? "",
    email: initial?.email ?? "",
    phone: initial?.phone ?? "",
    department: initial?.department ?? "",
    city: initial?.city ?? "",
    address: initial?.address ?? "",
    reference: initial?.reference ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const update = (k: keyof AddressFormValues) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setValues((v) => ({ ...v, [k]: e.target.value }));
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setErrors({});
    const parsed = addressSchema.safeParse(values);
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      parsed.error.issues.forEach((i) => { fe[i.path[0] as string] = i.message; });
      setErrors(fe);
      return;
    }
    setLoading(true);
    try {
      await onSave(parsed.data);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="grid gap-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-secondary block mb-1.5">Etiqueta</label>
          <Input value={values.label} onChange={update("label")} placeholder="Casa, Oficina" />
          {errors.label && <p className="text-xs text-destructive mt-1">{errors.label}</p>}
        </div>
        <div>
          <label className="text-sm font-medium text-secondary block mb-1.5">Destinatario</label>
          <Input value={values.fullName} onChange={update("fullName")} placeholder="Nombre completo" />
          {errors.fullName && <p className="text-xs text-destructive mt-1">{errors.fullName}</p>}
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-secondary block mb-1.5">Ciudad</label>
          <Input value={values.city} onChange={update("city")} />
          {errors.city && <p className="text-xs text-destructive mt-1">{errors.city}</p>}
        </div>
        <div>
          <label className="text-sm font-medium text-secondary block mb-1.5">Departamento</label>
          <Input value={values.department} onChange={update("department")} />
          {errors.department && <p className="text-xs text-destructive mt-1">{errors.department}</p>}
        </div>
      </div>
      <div>
        <label className="text-sm font-medium text-secondary block mb-1.5">Dirección</label>
        <Input value={values.address} onChange={update("address")} />
        {errors.address && <p className="text-xs text-destructive mt-1">{errors.address}</p>}
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-secondary block mb-1.5">Teléfono</label>
          <Input value={values.phone} onChange={update("phone")} />
        </div>
        <div>
          <label className="text-sm font-medium text-secondary block mb-1.5">Referencia (opcional)</label>
          <Input value={values.reference} onChange={update("reference")} />
        </div>
      </div>
      <div className="flex items-center gap-2 mt-2">
        <Button type="submit" disabled={loading}>{loading ? "Guardando..." : "Guardar dirección"}</Button>
        {onCancel && <Button variant="ghost" onClick={onCancel}>Cancelar</Button>}
      </div>
    </form>
  );
}
