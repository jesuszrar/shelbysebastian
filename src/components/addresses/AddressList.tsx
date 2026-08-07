import React, { useEffect, useState } from "react";
import AddressCard, { UserAddress } from "./AddressCard";
import AddressForm, { AddressFormValues } from "./AddressForm";
import { getUserAddresses, createUserAddress, patchUserAddress, deleteUserAddress, setDefaultUserAddress } from "@/integrations/api/client";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";

export default function AddressList({ onSelect }: { onSelect: (a: UserAddress) => void }) {
  const [addresses, setAddresses] = useState<UserAddress[] | null>(null);
  const [editing, setEditing] = useState<UserAddress | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = async () => {
    const res = await getUserAddresses();
    if (res.error) {
      setAddresses([]);
      return;
    }
    setAddresses((res.data ?? []) as UserAddress[]);
    const def = (res.data ?? []).find((a: any) => a.isDefault) as UserAddress | undefined;
    if (def) setSelectedId(def.id);
  };

  useEffect(() => { void load(); }, []);

  const handleUse = (addr: UserAddress) => {
    setSelectedId(addr.id);
    onSelect(addr);
  };

  const handleSave = async (values: AddressFormValues) => {
    try {
      if (editing) {
        await patchUserAddress(editing.id, values as Record<string, unknown>);
        toast.success("Dirección actualizada");
      } else {
        await createUserAddress(values as Record<string, unknown>);
        toast.success("Dirección creada");
      }
      setEditing(null);
      setShowForm(false);
      await load();
    } catch (err) {
      console.error(err);
      toast.error("No se pudo guardar la dirección");
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
  };

  const confirmDelete = async () => {
    if (!deletingId) return;
    const res = await deleteUserAddress(deletingId);
    setDeletingId(null);
    if (res.error) {
      toast.error(res.error.message || "No se pudo eliminar");
      return;
    }
    toast.success("Dirección eliminada");
    await load();
  };

  const handleSetDefault = async (id: string) => {
    const res = await setDefaultUserAddress(id);
    if (res.error) {
      toast.error(res.error.message || "No se pudo marcar principal");
      return;
    }
    toast.success("Dirección marcada como principal");
    await load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-xl">Mis direcciones</h3>
        <Button onClick={() => { setShowForm((s) => !s); setEditing(null); }}>{showForm ? "Cerrar" : "+ Agregar nueva dirección"}</Button>
      </div>

      {showForm && (
        <div className="bg-card border border-border rounded-2xl p-4">
          <AddressForm onCancel={() => setShowForm(false)} onSave={handleSave} initial={editing ?? undefined} />
        </div>
      )}

      <div className="grid gap-4">
        {addresses === null ? <div>Cargando...</div> : null}
        {(addresses ?? []).map((addr) => (
          <AddressCard
            key={addr.id}
            address={addr}
            selected={selectedId === addr.id}
            onUse={handleUse}
            onEdit={(a) => { setEditing(a); setShowForm(true); }}
            onDelete={handleDelete}
            onSetDefault={handleSetDefault}
          />
        ))}
      </div>

      <AlertDialog open={Boolean(deletingId)} onOpenChange={(open) => { if (!open) setDeletingId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar dirección</AlertDialogTitle>
            <AlertDialogDescription>¿Estás seguro de que deseas eliminar esta dirección? Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
