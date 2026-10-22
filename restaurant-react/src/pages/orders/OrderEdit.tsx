import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ordersService, OrderWithDetails, OrderItemWithMenu, PosSellableItem, isPaidOrder } from '../../services/orders.service';
import { OrderStatus, OrderPaymentMethod } from '../../types/database.types';
import { formatNumber, parseDecimal, roundMoney } from '../../lib/utils';
import { toUserMessage } from '../../lib/errors';
import { ORDER_STATUS_LABELS, PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from './orderLabels';
import {
  ArrowRight,
  Save,
  ShoppingCart,
  AlertCircle,
  CheckCircle,
  Plus,
  Trash2,
  Edit2,
} from 'lucide-react';

// A paid order can move between the kitchen states or be cancelled; it can't go back to unpaid.
const PAID_STATUSES: OrderStatus[] = ['paid', 'in_kitchen', 'preparing', 'ready', 'delivered', 'cancelled'];

const parseWholeQuantity = (value: string): number | null => {
  const n = parseDecimal(value);
  return n !== null && Number.isInteger(n) && n > 0 ? n : null;
};

export default function OrderEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState<OrderWithDetails | null>(null);
  const [sellableItems, setSellableItems] = useState<PosSellableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [itemBusy, setItemBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showAddItem, setShowAddItem] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [itemDraft, setItemDraft] = useState({ quantity: '', unit_price: '', notes: '' });

  const [formData, setFormData] = useState({
    status: 'new' as OrderStatus,
    payment_method: '' as OrderPaymentMethod | '',
    discount_amount: '0',
    discount_reason: '',
    notes: '',
    kitchen_notes: '',
    cancellation_reason: '',
  });
  // Status and payment method as loaded into the form: only values the admin changed are sent, so a kitchen
  // move made while this page was open (e.g. preparing -> ready) is not undone by saving a note or discount.
  const loaded = useRef({ status: 'new' as OrderStatus, payment_method: '' as OrderPaymentMethod | '' });

  const [newItem, setNewItem] = useState({
    item_id: '',
    quantity: '1',
    unit_price: '',
    notes: '',
  });

  useEffect(() => {
    if (id) fetchOrder(id, true);
  }, [id]);

  // Items can only be added from what the order's branch sells
  const fetchSellableItems = async (branchId: string) => {
    const { data, error: itemsError } = await ordersService.getSellableItems(branchId);
    if (itemsError) setError(toUserMessage(itemsError, 'تعذر تحميل أصناف الفرع'));
    setSellableItems(data);
  };

  const fetchOrder = async (orderId: string, resetForm: boolean) => {
    const { data, error: fetchError } = await ordersService.getById(orderId);
    if (fetchError) setError(toUserMessage(fetchError, 'تعذر تحميل الأوردر'));
    if (data) {
      setOrder(data);
      if (resetForm) {
        setFormData({
          status: data.status,
          // an unpaid order keeps an empty payment method: saving it never marks it as cash
          payment_method: data.payment_method || '',
          discount_amount: String(Number(data.discount_amount) || 0),
          discount_reason: data.discount_reason || '',
          notes: data.notes || '',
          kitchen_notes: data.kitchen_notes || '',
          cancellation_reason: data.cancellation_reason || '',
        });
        loaded.current = { status: data.status, payment_method: data.payment_method || '' };
        fetchSellableItems(data.branch_id);
      } else {
        // After a line edit: fields the admin has not touched follow the latest order (e.g. a kitchen move)
        const before = loaded.current;
        const latest = { status: data.status, payment_method: (data.payment_method || '') as OrderPaymentMethod | '' };
        loaded.current = latest;
        setFormData(f => ({
          ...f,
          status: f.status === before.status ? latest.status : f.status,
          payment_method: f.payment_method === before.payment_method ? latest.payment_method : f.payment_method,
        }));
      }
    }
    setLoading(false);
  };

  const paid = order ? isPaidOrder(order) : false;
  const cancelled = order?.status === 'cancelled';
  const statusOptions: OrderStatus[] = !order
    ? []
    : cancelled
      ? ['cancelled']
      : paid
        ? PAID_STATUSES
        : [order.status, 'cancelled'];

  const discountValue = formData.discount_amount.trim() === '' ? 0 : parseDecimal(formData.discount_amount);
  const orderGross = order ? roundMoney(Number(order.subtotal) + Number(order.tax_amount || 0)) : 0;
  const totalPreview = discountValue !== null && discountValue >= 0 ? roundMoney(orderGross - discountValue) : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !order || saving || cancelled) return;

    setError('');
    setSuccess('');

    if (discountValue === null || discountValue < 0) {
      setError('أدخل خصماً صحيحاً (صفر أو أكثر)');
      return;
    }
    if (discountValue > orderGross) {
      setError('الخصم أكبر من إجمالي الأوردر');
      return;
    }
    if (paid && !formData.payment_method) {
      setError('اختر طريقة الدفع');
      return;
    }
    if (formData.status === 'cancelled' &&
        !confirm('سيتم إلغاء الأوردر وإرجاع أصنافه إلى المخزون، ولن يمكن تعديله بعد ذلك. هل أنت متأكد؟')) {
      return;
    }

    setSaving(true);
    const { error: updateError } = await ordersService.updateOrder(id, {
      status: formData.status !== loaded.current.status ? formData.status : null,
      payment_method: paid && formData.payment_method && formData.payment_method !== loaded.current.payment_method
        ? formData.payment_method
        : null,
      discount_amount: roundMoney(discountValue),
      discount_reason: formData.discount_reason,
      notes: formData.notes,
      kitchen_notes: formData.kitchen_notes,
      cancellation_reason: formData.status === 'cancelled' ? formData.cancellation_reason : undefined,
    });

    if (updateError) {
      setError(toUserMessage(updateError, 'فشل في تحديث الأوردر'));
      setSaving(false);
    } else {
      setSuccess('تم تحديث الأوردر بنجاح');
      setTimeout(() => navigate('/orders'), 1500);
    }
  };

  const handleAddItem = async () => {
    if (!id || itemBusy) return;
    setError('');
    if (!newItem.item_id) {
      setError('اختر الصنف');
      return;
    }
    const quantity = parseWholeQuantity(newItem.quantity);
    if (quantity === null) {
      setError('الكمية يجب أن تكون عدداً صحيحاً أكبر من صفر');
      return;
    }
    let unitPrice: number | null = null;
    if (newItem.unit_price.trim() !== '') {
      unitPrice = parseDecimal(newItem.unit_price);
      if (unitPrice === null || unitPrice < 0) {
        setError('أدخل سعراً صحيحاً (صفر أو أكثر)');
        return;
      }
      unitPrice = roundMoney(unitPrice);
    }

    setItemBusy(true);
    const { error: addError } = await ordersService.addOrderItem(id, {
      item_id: newItem.item_id,
      quantity,
      unit_price: unitPrice,
      notes: newItem.notes.trim() || undefined,
    });
    if (addError) {
      setError(toUserMessage(addError, 'فشل في إضافة الصنف'));
    } else {
      await fetchOrder(id, false);
      setShowAddItem(false);
      setItemSearch('');
      setNewItem({ item_id: '', quantity: '1', unit_price: '', notes: '' });
    }
    setItemBusy(false);
  };

  const startEditItem = (item: OrderItemWithMenu) => {
    setEditingItem(item.id);
    setItemDraft({
      quantity: String(item.quantity),
      unit_price: String(Number(item.unit_price) || 0),
      notes: item.notes || '',
    });
  };

  const handleUpdateItem = async (item: OrderItemWithMenu) => {
    if (!id || itemBusy) return;
    setError('');
    const quantity = parseWholeQuantity(itemDraft.quantity);
    if (quantity === null) {
      setError('الكمية يجب أن تكون عدداً صحيحاً أكبر من صفر');
      return;
    }
    const unitPrice = parseDecimal(itemDraft.unit_price);
    if (unitPrice === null || unitPrice < 0) {
      setError('أدخل سعراً صحيحاً (صفر أو أكثر)');
      return;
    }

    setItemBusy(true);
    const { error: updateError } = await ordersService.updateOrderItem(item.id, {
      quantity,
      unit_price: roundMoney(unitPrice),
      notes: itemDraft.notes.trim() || null,
    });
    if (updateError) {
      setError(toUserMessage(updateError, 'فشل في تحديث الصنف'));
    } else {
      await fetchOrder(id, false);
      setEditingItem(null);
    }
    setItemBusy(false);
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!id || itemBusy) return;
    if (!confirm('هل أنت متأكد من حذف هذا الصنف؟')) return;
    setError('');

    setItemBusy(true);
    const { error: deleteError } = await ordersService.deleteOrderItem(itemId);
    if (deleteError) {
      setError(toUserMessage(deleteError, 'فشل في حذف الصنف'));
    } else {
      await fetchOrder(id, false);
    }
    setItemBusy(false);
  };

  const handleNewItemSelect = (itemId: string) => {
    const item = sellableItems.find(m => m.item_id === itemId);
    setNewItem({ ...newItem, item_id: itemId, unit_price: item ? String(item.price) : '' });
  };

  const formatCurrency = (amount: number | null | undefined) => (Number(amount) || 0).toLocaleString('ar-EG') + ' ج.م';

  const searchTerm = itemSearch.trim().toLowerCase();
  const itemChoices = (searchTerm
    ? sellableItems.filter(m =>
        m.name_ar?.toLowerCase().includes(searchTerm) ||
        m.code?.toLowerCase().includes(searchTerm) ||
        m.barcode?.toLowerCase().includes(searchTerm))
    : sellableItems
  ).slice(0, 300);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="text-center py-12">
        <p className={error ? 'text-red-600' : 'text-gray-500'}>{error || 'الأوردر غير موجود'}</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <button type="button" onClick={() => navigate('/orders')} className="p-2 hover:bg-gray-100 rounded-lg" title="رجوع">
          <ArrowRight className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ShoppingCart className="w-6 h-6 text-blue-600" />
            تعديل الأوردر
          </h1>
          <p className="text-gray-600 font-mono">{order.order_number}</p>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {success && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-green-500" />
          <p className="text-green-700">{success}</p>
        </div>
      )}

      {cancelled && (
        <div className="mb-6 p-4 bg-gray-50 border border-gray-200 rounded-lg text-gray-700">
          هذا الأوردر ملغي ولا يمكن تعديله.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Order Info */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">معلومات الأوردر</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div><p className="text-sm text-gray-500">الفرع</p><p className="font-medium">{order.branch?.name_ar || '-'}</p></div>
            <div><p className="text-sm text-gray-500">الكاشير</p><p className="font-medium">{order.cashier?.full_name_ar || '-'}</p></div>
            <div><p className="text-sm text-gray-500">المجموع الفرعي</p><p className="font-medium">{formatCurrency(order.subtotal)}</p></div>
            <div><p className="text-sm text-gray-500">الإجمالي</p><p className="font-medium text-green-600 text-lg">{formatCurrency(order.total_amount)}</p></div>
          </div>
          {!paid && !cancelled && (
            <p className="mt-4 text-sm text-orange-600">هذا الأوردر غير مدفوع: لا يدخل في مبيعات الشيفت، ويمكن إلغاؤه فقط.</p>
          )}
        </div>

        {/* Order Items - Editable */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">الأصناف</h2>
            {!cancelled && (
              <button type="button" onClick={() => setShowAddItem(true)} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
                <Plus className="w-4 h-4" />
                إضافة صنف
              </button>
            )}
          </div>

          {/* Add Item Form */}
          {showAddItem && !cancelled && (
            <div className="mb-4 p-4 bg-gray-50 rounded-lg border space-y-3">
              <input
                type="text"
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="بحث عن صنف بالاسم أو الكود..."
                aria-label="بحث عن صنف"
              />
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <select value={newItem.item_id} onChange={(e) => handleNewItemSelect(e.target.value)} className="px-3 py-2 border rounded-lg" aria-label="اختر صنف">
                  <option value="">اختر صنف...</option>
                  {itemChoices.map(m => <option key={m.item_id} value={m.item_id}>{m.name_ar} - {formatCurrency(m.price)}</option>)}
                </select>
                <input type="text" inputMode="numeric" value={newItem.quantity} onChange={(e) => setNewItem({ ...newItem, quantity: e.target.value })} className="px-3 py-2 border rounded-lg" placeholder="الكمية" aria-label="الكمية" />
                <input type="text" inputMode="decimal" value={newItem.unit_price} onChange={(e) => setNewItem({ ...newItem, unit_price: e.target.value })} className="px-3 py-2 border rounded-lg" placeholder="السعر (سعر الفرع افتراضياً)" aria-label="السعر" />
                <div className="flex gap-2">
                  <button type="button" onClick={handleAddItem} disabled={itemBusy} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">إضافة</button>
                  <button type="button" onClick={() => setShowAddItem(false)} disabled={itemBusy} className="px-4 py-2 bg-gray-300 rounded-lg hover:bg-gray-400 disabled:opacity-50">إلغاء</button>
                </div>
              </div>
            </div>
          )}

          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-right py-2 text-sm font-medium text-gray-700">الصنف</th>
                <th className="text-right py-2 text-sm font-medium text-gray-700">الكمية</th>
                <th className="text-right py-2 text-sm font-medium text-gray-700">السعر</th>
                <th className="text-right py-2 text-sm font-medium text-gray-700">الإجمالي</th>
                <th className="py-2 text-sm font-medium text-gray-700">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {order.items?.map((item) => {
                const editing = editingItem === item.id;
                const draftQty = parseDecimal(itemDraft.quantity);
                const draftPrice = parseDecimal(itemDraft.unit_price);
                const lineTotal = editing && draftQty !== null && draftPrice !== null
                  ? roundMoney(draftQty * draftPrice)
                  : Number(item.total_price) || 0;
                return (
                  <tr key={item.id} className="border-b border-gray-100">
                    <td className="py-2">
                      {item.item?.name_ar ?? item.menu_item?.name_ar ?? '-'}
                      {editing ? (
                        <input type="text" value={itemDraft.notes} onChange={(e) => setItemDraft({ ...itemDraft, notes: e.target.value })} className="block mt-1 w-full px-2 py-1 border rounded text-sm" placeholder="ملاحظة" aria-label="ملاحظة الصنف" />
                      ) : item.notes && <p className="text-sm text-gray-500">{item.notes}</p>}
                    </td>
                    <td className="py-2">
                      {editing ? (
                        <input type="text" inputMode="numeric" value={itemDraft.quantity} onChange={(e) => setItemDraft({ ...itemDraft, quantity: e.target.value })} className="w-20 px-2 py-1 border rounded" aria-label="الكمية" />
                      ) : formatNumber(item.quantity)}
                    </td>
                    <td className="py-2">
                      {editing ? (
                        <input type="text" inputMode="decimal" value={itemDraft.unit_price} onChange={(e) => setItemDraft({ ...itemDraft, unit_price: e.target.value })} className="w-24 px-2 py-1 border rounded" aria-label="السعر" />
                      ) : formatCurrency(item.unit_price)}
                    </td>
                    <td className="py-2">{formatCurrency(lineTotal)}</td>
                    <td className="py-2">
                      {!cancelled && (
                        <div className="flex items-center gap-2">
                          {editing ? (
                            <>
                              <button type="button" onClick={() => handleUpdateItem(item)} disabled={itemBusy} className="p-1 text-green-600 hover:bg-green-50 rounded disabled:opacity-50" title="حفظ"><CheckCircle className="w-4 h-4" /></button>
                              <button type="button" onClick={() => setEditingItem(null)} disabled={itemBusy} className="p-1 text-gray-600 hover:bg-gray-50 rounded disabled:opacity-50" title="إلغاء"><AlertCircle className="w-4 h-4" /></button>
                            </>
                          ) : (
                            <>
                              <button type="button" onClick={() => startEditItem(item)} disabled={itemBusy} className="p-1 text-blue-600 hover:bg-blue-50 rounded disabled:opacity-50" title="تعديل"><Edit2 className="w-4 h-4" /></button>
                              <button type="button" onClick={() => handleDeleteItem(item.id)} disabled={itemBusy} className="p-1 text-red-600 hover:bg-red-50 rounded disabled:opacity-50" title="حذف"><Trash2 className="w-4 h-4" /></button>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Editable Fields */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">تعديل الأوردر</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">الحالة</label>
              <select value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value as OrderStatus })} disabled={cancelled} className="w-full px-4 py-2 border border-gray-300 rounded-lg disabled:bg-gray-50" aria-label="الحالة">
                {statusOptions.map((status) => <option key={status} value={status}>{ORDER_STATUS_LABELS[status]}</option>)}
              </select>
              {formData.status === 'cancelled' && !cancelled && (
                <p className="mt-1 text-sm text-red-600">إلغاء الأوردر يعيد أصنافه إلى المخزون ويخرجه من مبيعات الشيفت.</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">طريقة الدفع</label>
              <select value={formData.payment_method} onChange={(e) => setFormData({ ...formData, payment_method: e.target.value as OrderPaymentMethod | '' })} disabled={!paid || cancelled} className="w-full px-4 py-2 border border-gray-300 rounded-lg disabled:bg-gray-50" aria-label="طريقة الدفع">
                {!paid && <option value="">غير مدفوع</option>}
                {paid && PAYMENT_METHODS.map((method) => <option key={method} value={method}>{PAYMENT_METHOD_LABELS[method]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">الخصم</label>
              <input type="text" inputMode="decimal" value={formData.discount_amount} onChange={(e) => setFormData({ ...formData, discount_amount: e.target.value })} disabled={cancelled} className="w-full px-4 py-2 border border-gray-300 rounded-lg disabled:bg-gray-50" aria-label="الخصم" />
              {!cancelled && (
                <p className={`mt-1 text-sm ${totalPreview === null || totalPreview < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                  {totalPreview === null ? 'قيمة غير صحيحة' : totalPreview < 0 ? 'الخصم أكبر من إجمالي الأوردر' : `الإجمالي بعد الخصم: ${formatCurrency(totalPreview)}`}
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">سبب الخصم</label>
              <input type="text" value={formData.discount_reason} onChange={(e) => setFormData({ ...formData, discount_reason: e.target.value })} disabled={cancelled} className="w-full px-4 py-2 border border-gray-300 rounded-lg disabled:bg-gray-50" placeholder="سبب الخصم..." />
            </div>
            {formData.status === 'cancelled' && (
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">سبب الإلغاء</label>
                <input type="text" value={formData.cancellation_reason} onChange={(e) => setFormData({ ...formData, cancellation_reason: e.target.value })} disabled={cancelled} className="w-full px-4 py-2 border border-gray-300 rounded-lg disabled:bg-gray-50" placeholder="سبب الإلغاء..." />
              </div>
            )}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">ملاحظات</label>
              <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} disabled={cancelled} rows={2} className="w-full px-4 py-2 border border-gray-300 rounded-lg disabled:bg-gray-50" placeholder="ملاحظات..." />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">ملاحظات المطبخ</label>
              <textarea value={formData.kitchen_notes} onChange={(e) => setFormData({ ...formData, kitchen_notes: e.target.value })} disabled={cancelled} rows={2} className="w-full px-4 py-2 border border-gray-300 rounded-lg disabled:bg-gray-50" placeholder="ملاحظات للمطبخ..." />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-4">
          {!cancelled && (
            <button type="submit" disabled={saving || itemBusy} className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? <><span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />جاري الحفظ...</> : <><Save className="w-5 h-5" />حفظ التعديلات</>}
            </button>
          )}
          <button type="button" onClick={() => navigate('/orders')} className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg">إلغاء</button>
        </div>
      </form>
    </div>
  );
}
