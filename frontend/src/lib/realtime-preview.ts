// Sample lines for the Real-time playground.
//
// There is no real-time API yet, so a session plays these instead of translating
// anything. When the API exists, the session in pages/Realtime.tsx reads from it
// and this file goes away.
export const SAMPLE_COUNT = 3

const SAMPLES: Record<string, [string, string, string]> = {
  en: [
    'Hello everyone, thank you for joining us today.',
    'Today I will show you how our new product works.',
    'If you have any questions, please ask them at the end.',
  ],
  uz: [
    'Hammaga salom, bugun biz bilan bo‘lganingiz uchun rahmat.',
    'Bugun sizga yangi mahsulotimiz qanday ishlashini ko‘rsataman.',
    'Savollaringiz bo‘lsa, iltimos, oxirida bering.',
  ],
  ru: [
    'Всем привет, спасибо, что присоединились к нам сегодня.',
    'Сегодня я покажу вам, как работает наш новый продукт.',
    'Если у вас есть вопросы, задайте их, пожалуйста, в конце.',
  ],
  tr: [
    'Herkese merhaba, bugün bize katıldığınız için teşekkürler.',
    'Bugün size yeni ürünümüzün nasıl çalıştığını göstereceğim.',
    'Sorularınız varsa lütfen sonunda sorun.',
  ],
  es: [
    'Hola a todos, gracias por acompañarnos hoy.',
    'Hoy les mostraré cómo funciona nuestro nuevo producto.',
    'Si tienen alguna pregunta, háganla al final, por favor.',
  ],
  fr: [
    'Bonjour à tous, merci de nous avoir rejoints aujourd’hui.',
    'Aujourd’hui, je vais vous montrer comment fonctionne notre nouveau produit.',
    'Si vous avez des questions, posez-les à la fin, s’il vous plaît.',
  ],
  de: [
    'Hallo zusammen, danke, dass Sie heute dabei sind.',
    'Heute zeige ich Ihnen, wie unser neues Produkt funktioniert.',
    'Wenn Sie Fragen haben, stellen Sie sie bitte am Ende.',
  ],
  ar: [
    'مرحبًا بالجميع، شكرًا لانضمامكم إلينا اليوم.',
    'سأريكم اليوم كيف يعمل منتجنا الجديد.',
    'إذا كانت لديكم أسئلة، فيرجى طرحها في النهاية.',
  ],
  zh: [
    '大家好，感谢大家今天的参与。',
    '今天我将向大家展示我们的新产品是如何运作的。',
    '如有任何问题，请在最后提问。',
  ],
}

/** Sample line `index` in `lang`, or null when that language has no samples. */
export function sampleLine(index: number, lang: string): string | null {
  return SAMPLES[lang]?.[index] ?? null
}
