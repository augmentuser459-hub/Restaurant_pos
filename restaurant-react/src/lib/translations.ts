// Arabic translations for the application

export const translations = {
  // Navigation
  nav: {
    dashboard: 'لوحة التحكم',
    branches: 'الفروع',
    suppliers: 'الموردين',
    inventory: 'المخزون',
    transfers: 'التحويلات',
    damages: 'التالف',
    pos: 'نقطة البيع',
    kitchen: 'المطبخ',
    reports: 'التقارير',
    purchase: 'المشتريات',
    users: 'المستخدمين',
    settings: 'الإعدادات',
  },

  // Common actions
  actions: {
    add: 'إضافة',
    edit: 'تعديل',
    delete: 'حذف',
    save: 'حفظ',
    cancel: 'إلغاء',
    search: 'بحث',
    filter: 'تصفية',
    export: 'تصدير',
    print: 'طباعة',
    view: 'عرض',
    approve: 'موافقة',
    reject: 'رفض',
    submit: 'إرسال',
    back: 'رجوع',
    close: 'إغلاق',
    confirm: 'تأكيد',
  },

  // Status labels
  status: {
    active: 'نشط',
    inactive: 'غير نشط',
    pending: 'معلق',
    approved: 'موافق عليه',
    rejected: 'مرفوض',
    completed: 'مكتمل',
    cancelled: 'ملغي',
    draft: 'مسودة',
    new: 'جديد',
    paid: 'مدفوع',
    in_kitchen: 'في المطبخ',
    preparing: 'قيد التحضير',
    ready: 'جاهز',
    delivered: 'تم التسليم',
    received: 'مستلم',
  },

  // Form labels
  form: {
    code: 'الكود',
    name: 'الاسم',
    nameAr: 'الاسم بالعربي',
    nameEn: 'الاسم بالإنجليزي',
    phone: 'رقم الهاتف',
    email: 'البريد الإلكتروني',
    address: 'العنوان',
    notes: 'ملاحظات',
    description: 'الوصف',
    quantity: 'الكمية',
    price: 'السعر',
    total: 'الإجمالي',
    date: 'التاريخ',
    branch: 'الفرع',
    supplier: 'المورد',
    item: 'الصنف',
    category: 'التصنيف',
    unit: 'الوحدة',
    status: 'الحالة',
  },

  // Messages
  messages: {
    loading: 'جاري التحميل...',
    saving: 'جاري الحفظ...',
    success: 'تمت العملية بنجاح',
    error: 'حدث خطأ',
    confirmDelete: 'هل أنت متأكد من الحذف؟',
    noData: 'لا توجد بيانات',
    required: 'هذا الحقل مطلوب',
  },

  // Roles
  roles: {
    admin: 'مدير النظام',
    warehouse_manager: 'مدير المخزن',
    branch_supervisor: 'مشرف الفرع',
    chef: 'شيف',
    cashier: 'كاشير',
    purchase_manager: 'مدير المشتريات',
  },

  // Payment methods
  paymentMethods: {
    cash: 'نقدي',
    visa: 'فيزا',
    instapay: 'انستاباي',
    wallet: 'محفظة',
    credit: 'آجل',
  },

  // Time
  time: {
    today: 'اليوم',
    yesterday: 'أمس',
    thisWeek: 'هذا الأسبوع',
    thisMonth: 'هذا الشهر',
    lastMonth: 'الشهر الماضي',
    custom: 'فترة مخصصة',
  },
}

export type TranslationKey = keyof typeof translations
