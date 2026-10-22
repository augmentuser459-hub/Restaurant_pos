import { Info, Package, Users, TrendingUp, Shield, Zap } from 'lucide-react'
import { APP_VERSION } from './appInfo'

export default function About() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-800 rounded-lg shadow-lg p-8 text-white">
        <div className="flex items-center gap-4 mb-4">
          <div className="bg-white/20 p-3 rounded-lg">
            <Info className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">نظام إدارة المطاعم</h1>
            <p className="text-blue-100 mt-1">حل متكامل لإدارة عمليات المطاعم والمخازن</p>
          </div>
        </div>
      </div>

      {/* Description */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">وصف التطبيق</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          نظام إدارة المطاعم هو حل شامل ومتكامل مصمم خصيصاً لتلبية احتياجات المطاعم والمقاهي من جميع الأحجام. 
          يوفر النظام أدوات قوية لإدارة المخزون، نقاط البيع، الموردين، والتقارير المالية والتشغيلية.
        </p>
        <p className="text-gray-700 leading-relaxed">
          تم تطوير النظام باستخدام أحدث التقنيات لضمان الأداء العالي، الأمان، وسهولة الاستخدام. 
          يدعم النظام إدارة فروع متعددة، تتبع المخزون بدقة، وإصدار تقارير تفصيلية لمساعدتك في اتخاذ القرارات الصحيحة.
        </p>
      </div>

      {/* Features */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-6">المميزات الرئيسية</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Feature 1 */}
          <div className="flex gap-4">
            <div className="bg-blue-100 p-3 rounded-lg h-fit">
              <Package className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">إدارة المخزون</h3>
              <p className="text-sm text-gray-600">
                تتبع دقيق للمخزون في جميع الفروع، تنبيهات المخزون المنخفض، وإدارة التحويلات بين الفروع
              </p>
            </div>
          </div>

          {/* Feature 2 */}
          <div className="flex gap-4">
            <div className="bg-green-100 p-3 rounded-lg h-fit">
              <Users className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">إدارة المستخدمين</h3>
              <p className="text-sm text-gray-600">
                نظام صلاحيات متقدم، إدارة الأدوار، وتتبع نشاطات المستخدمين لضمان الأمان والمساءلة
              </p>
            </div>
          </div>

          {/* Feature 3 */}
          <div className="flex gap-4">
            <div className="bg-purple-100 p-3 rounded-lg h-fit">
              <TrendingUp className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">التقارير والتحليلات</h3>
              <p className="text-sm text-gray-600">
                تقارير شاملة للمبيعات، المخزون، الموردين، والأداء المالي مع إمكانية التصدير لـ Excel
              </p>
            </div>
          </div>

          {/* Feature 4 */}
          <div className="flex gap-4">
            <div className="bg-orange-100 p-3 rounded-lg h-fit">
              <Shield className="w-6 h-6 text-orange-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">الأمان والموثوقية</h3>
              <p className="text-sm text-gray-600">
                حماية متقدمة للبيانات، نسخ احتياطي تلقائي، وتشفير للمعلومات الحساسة
              </p>
            </div>
          </div>

          {/* Feature 5 */}
          <div className="flex gap-4">
            <div className="bg-red-100 p-3 rounded-lg h-fit">
              <Zap className="w-6 h-6 text-red-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">نقاط البيع (POS)</h3>
              <p className="text-sm text-gray-600">
                واجهة سريعة وسهلة للكاشير، دعم الباركود، وإدارة الطلبات والمطبخ بكفاءة
              </p>
            </div>
          </div>

          {/* Feature 6 */}
          <div className="flex gap-4">
            <div className="bg-yellow-100 p-3 rounded-lg h-fit">
              <Package className="w-6 h-6 text-yellow-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">إدارة الموردين</h3>
              <p className="text-sm text-gray-600">
                متابعة أوامر الشراء، كشوف حساب الموردين، وإدارة المدفوعات والمستحقات
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-gray-900 text-white rounded-lg p-6 text-center">
        <p className="text-lg font-semibold mb-2">© 2026 Hive Tech AI. جميع الحقوق محفوظة.</p>
        <p className="text-gray-400 text-sm">
          تم التطوير بواسطة{' '}
          <a 
            href="https://hive-tech.ai" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 underline transition-colors"
          >
            Hive Tech AI
          </a>
          {' '}- حلول تقنية متقدمة
        </p>
        <p className="text-gray-500 text-xs mt-2">v{APP_VERSION}</p>
      </div>
    </div>
  )
}
