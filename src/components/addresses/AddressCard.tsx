import React from "react";
import { Button } from "@/components/ui/button";

export type UserAddress = {
  id: string;
  label: string;
  fullName: string;
  cedula?: string | null;
  email?: string | null;
  phone?: string | null;
  department: string;
  city: string;
  address: string;
  reference?: string | null;
  isDefault: boolean;
};

export default function AddressCard({
  address,
  selected,
  onUse,
  onEdit,
  onDelete,
  onSetDefault,
}: {
  address: UserAddress;
  selected: boolean;
  onUse: (a: UserAddress) => void;
  onEdit: (a: UserAddress) => void;
  onDelete: (id: string) => void;
  onSetDefault: (id: string) => void;
}) {
  return (
    <div className={`p-4 rounded-2xl border ${selected ? "border-primary bg-card shadow-soft" : "border-border bg-background"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <div className="font-medium text-secondary">{address.label}</div>
            {address.isDefault && <div className="text-xs text-primary/90 bg-primary/10 px-2 py-0.5 rounded-full">Principal</div>}
          </div>
          <div className="text-sm text-secondary/90 mt-2">{address.fullName}</div>
          <div className="text-sm text-muted-foreground">{address.address}</div>
          <div className="text-sm text-muted-foreground">{address.city} · {address.department}</div>
          {address.phone && <div className="text-sm text-muted-foreground">Tel: {address.phone}</div>}
        </div>
        <div className="flex flex-col items-end gap-2">
          <Button size="sm" onClick={() => onUse(address)} className="mb-1">Usar esta dirección</Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => onEdit(address)}>Editar</Button>
            <Button variant="destructive" size="sm" onClick={() => onDelete(address.id)}>Eliminar</Button>
          </div>
          {!address.isDefault && (
            <Button variant="outline" size="sm" onClick={() => onSetDefault(address.id)} className="mt-2">Marcar principal</Button>
          )}
        </div>
      </div>
    </div>
  );
}
