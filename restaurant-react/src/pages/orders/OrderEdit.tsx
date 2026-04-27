import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ordersService, OrderWithDetails, OrderItemWithMenu } from '../../services/orders.service';
import { OrderStatus, OrderPaymentMethod, MenuItem } from '../../types/database.types';
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

const STATUS_OPTIONS: { value: OrderStatus; label: string }[] = [
  { value: 'new', label: 'جديد' },
  { value: 'pending_payment', label: 'في انتظار الدفع' },
  { value: 'paid', label: 'مدفوع' },
  { value: 'in_kitchen', label: 'في المطبخ' },
  { value: 'preparing', label: 'قيد التحضير' },
  { value: 'ready', label: 'جاهز' },
  { value: 'delivered', label: 'تم التسليم' },
  { value: 'cancelled', label: 'ملغي' },
];

const PAYMENT_OPTIONS: { value: OrderPaymentMethod; label: string }[] = [
  { value: 'cash', label: 'كاش' },
  { value: 'visa', label: 'فيزا' },
  { value: 'instapay', label: 'انستاباي' },
  { value: 'wallet', label: 'محفظة' },
];

export default function OrderEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState<OrderWithDetails | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showAddItem, setShowAddItem] = useState(false);
  const [editingItem, setEditingItem] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    status: 'new' as OrderStatus,
    payment_method: 'cash' as OrderPaymentMethod,
    discount_amount: 0,
    discount_reason: '',
    notes: '',
    kitchen_notes: '',
  });

  const [newItem, setNewItem] = useState({
    menu_item_id: '',
    quantity: 1,
    unit_price: 0,
    notes: '',
  });

  useEffect(() => {
    fetchMenuItems();
    if (id) fetchOrder(id);
  }, [id]);

  const fetchMenuItems = async () => {
    const { data } = await ordersService.getMenuItems();
    setMenuItems(data || []);
  };

  const fetchOrder = async (orderId: string) => {
    const { data } = await ordersService.getById(orderId);
    if (data) {
      setOrder(data);
      setFormData({
        status: data.status,
        payment_method: data.payment_method || 'cash',
        discount_amount: data.discount_amount || 0,
        discount_reason: (data as unknown as Record<string, string>).discount_reason || '',
        notes: data.notes || '',
        kitchen_notes: (data as unknown as Record<string, string>).kitchen_notes || '',
      });
    }
    setLoading(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;

    setError('');
    setSuccess('');
    setSaving(true);

    const { error: updateError } = await ordersService.updateOrder(id, formData);

    if (updateError) {
      setError('فشل في تحديث الأوردر: ' + updateError.message);
    } else {
      setSuccess('تم تحديث الأوردر بنجاح');
      setTimeout(() => navigate('/orders'), 1500);
    }
    setSaving(false);
  };

  const handleAddItem = async () => {
    if (!id || !newItem.menu_item_id) return;
    
    const { error } = await ordersService.addOrderItem(id, newItem);
    if (error) {
      setError('فشل في إضافة الصنف');
      return;
    }
    
    await ordersService.recalculateOrderTotals(id);
    await fetchOrder(id);
    setShowAddItem(false);
    setNewItem({ menu_item_id: '', quantity: 1, unit_price: 0, notes: '' });
  };

  const handleUpdateItem = async (item: OrderItemWithMenu) => {
    const { error } = await ordersService.updateOrderItem(item.id, {
      quantity: item.quantity,
      unit_price: item.unit_price,
      notes: item.notes || undefined,
    });
    
    if (error) {
      setError('فشل في تحديث الصنف');
      return;
    }
    
    if (id) {
      await ordersService.recalculateOrderTotals(id);
      await fetchOrder(id);
    }
    setEditingItem(null);
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!confirm('هل أنت متأكد من حذف هذا الصنف؟')) return;
    
    const { error } = await ordersService.deleteOrderItem(itemId);
    if (error) {
      setError('فشل في حذف الصنف');
      return;
    }
    
    if (id) {
      await ordersService.recalculateOrderTotals(id);
      await fetchOrder(id);
    }
  };

  const handleMenuItemSelect = (menuItemId: string) => {
    const item = menuItems.find(m => m.id === menuItemId);
    if (item) {
      setNewItem({ ...newItem, menu_item_id: menuItemId, unit_price: item.price || 0 });
    }
  };

  const updateItemInOrder = (itemId: string, field: string, value: number | string) => {
    if (!order?.items) return;
    const updatedItems = order.items.map(item => 
      item.id === itemId ? { ...item, [field]: value } : item
    );
    setOrder({ ...order, items: updatedItems });
  };

  const formatCurrency = (amount: number) => (amount || 0).toLocaleString('ar-EG') + ' ج.م';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!order) {
    return <div className="text-center py-12"><p className="text-gray-500">الأوردر غير موجود</p></div>;
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
        </div>

        {/* Order Items - Editable */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">الأصناف</h2>
            <button type="button" onClick={() => setShowAddItem(true)} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
              <Plus className="w-4 h-4" />
              إضافة صنف
            </button>
          </div>

          {/* Add Item Form */}
          {showAddItem && (
            <div className="mb-4 p-4 bg-gray-50 rounded-lg border">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <select value={newItem.menu_item_id} onChange={(e) => handleMenuItemSelect(e.target.value)} className="px-3 py-2 border rounded-lg" aria-label="اختر صنف">
                  <option value="">اختر صنف...</option>
                  {menuItems.map(m => <option key={m.id} value={m.id}>{m.name_ar} - {formatCurrency(m.price || 0)}</option>)}
                </select>
                <input type="number" min="1" value={newItem.quantity} onChange={(e) => setNewItem({ ...newItem, quantity: Number(e.target.value) })} className="px-3 py-2 border rounded-lg" placeholder="الكمية" aria-label="الكمية" />
                <input type="number" min="0" step="0.01" value={newItem.unit_price} onChange={(e) => setNewItem({ ...newItem, unit_price: Number(e.target.value) })} className="px-3 py-2 border rounded-lg" placeholder="السعر" aria-label="السعر" />
                <div className="flex gap-2">
                  <button type="button" onClick={handleAddItem} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">إضافة</button>
                  <button type="button" onClick={() => setShowAddItem(false)} className="px-4 py-2 bg-gray-300 rounded-lg hover:bg-gray-400">إلغاء</button>
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
              {order.items?.map((item) => (
                <tr key={item.id} className="border-b border-gray-100">
                  <td className="py-2">{item.menu_item?.name_ar || '-'}</td>
                  <td className="py-2">
                    {editingItem === item.id ? (
                      <input type="number" min="1" value={item.quantity} onChange={(e) => updateItemInOrder(item.id, 'quantity', Number(e.target.value))} className="w-20 px-2 py-1 border rounded" aria-label="الكمية" />
                    ) : item.quantity}
                  </td>
                  <td className="py-2">
                    {editingItem === item.id ? (
                      <input type="number" min="0" step="0.01" value={item.unit_price} onChange={(e) => updateItemInOrder(item.id, 'unit_price', Number(e.target.value))} className="w-24 px-2 py-1 border rounded" aria-label="السعر" />
                    ) : formatCurrency(item.unit_price)}
                  </td>
                  <td className="py-2">{formatCurrency(item.quantity * item.unit_price)}</td>
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      {editingItem === item.id ? (
                        <>
                          <button type="button" onClick={() => handleUpdateItem(item)} className="p-1 text-green-600 hover:bg-green-50 rounded" title="حفظ"><CheckCircle className="w-4 h-4" /></button>
                          <button type="button" onClick={() => { setEditingItem(null); if (id) fetchOrder(id); }} className="p-1 text-gray-600 hover:bg-gray-50 rounded" title="إلغاء"><AlertCircle className="w-4 h-4" /></button>
                        </>
                      ) : (
                        <>
                          <button type="button" onClick={() => setEditingItem(item.id)} className="p-1 text-blue-600 hover:bg-blue-50 rounded" title="تعديل"><Edit2 className="w-4 h-4" /></button>
                          <button type="button" onClick={() => handleDeleteItem(item.id)} className="p-1 text-red-600 hover:bg-red-50 rounded" title="حذف"><Trash2 className="w-4 h-4" /></button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Editable Fields */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">تعديل الأوردر</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">الحالة</label>
              <select value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value as OrderStatus })} className="w-full px-4 py-2 border border-gray-300 rounded-lg" aria-label="الحالة">
                {STATUS_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">طريقة الدفع</label>
              <select value={formData.payment_method} onChange={(e) => setFormData({ ...formData, payment_method: e.target.value as OrderPaymentMethod })} className="w-full px-4 py-2 border border-gray-300 rounded-lg" aria-label="طريقة الدفع">
                {PAYMENT_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">الخصم</label>
              <input type="number" min="0" step="0.01" value={formData.discount_amount} onChange={(e) => setFormData({ ...formData, discount_amount: Number(e.target.value) })} className="w-full px-4 py-2 border border-gray-300 rounded-lg" aria-label="الخصم" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">سبب الخصم</label>
              <input type="text" value={formData.discount_reason} onChange={(e) => setFormData({ ...formData, discount_reason: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg" placeholder="سبب الخصم..." />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">ملاحظات</label>
              <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={2} className="w-full px-4 py-2 border border-gray-300 rounded-lg" placeholder="ملاحظات..." />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">ملاحظات المطبخ</label>
              <textarea value={formData.kitchen_notes} onChange={(e) => setFormData({ ...formData, kitchen_notes: e.target.value })} rows={2} className="w-full px-4 py-2 border border-gray-300 rounded-lg" placeholder="ملاحظات للمطبخ..." />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-4">
          <button type="submit" disabled={saving} className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving ? <><span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />جاري الحفظ...</> : <><Save className="w-5 h-5" />حفظ التعديلات</>}
          </button>
          <button type="button" onClick={() => navigate('/orders')} className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg">إلغاء</button>
        </div>
      </form>
    </div>
  );
}
