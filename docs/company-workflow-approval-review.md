> تحديث بعد هذه المراجعة: أُصلحت ملاحظة إدراج accepted_at ورحلة تسجيل المدعو وتأكيده. الحصر والنتائج أدناه لقطة تاريخية؛ أحدث الأدلة في organization-invitation-fixes.md.

# مراجعة اعتماد Company Workflow — 2026-11-07

الفرع: `feat/company-workflow`. آخر commit: `c5cb1af365ef4ff7f1c2ef139be021347c6c35f6`. تغييرات التنفيذ كلها محلية وغير محفوظة في commit. هذه المرحلة مراجعة فقط: لم تغيّر كود التطبيق أو Migration، ولم ترقِّ اعتماديات؛ أضافت هذا التقرير.

## Prisma الأصلي وإعداد Cloud

- فُحصت الأدوات المتاحة: توجد قراءة حالة البيئة وقراءة/حفظ المسودة، ولا توجد أداة لتطبيق سياسة الشبكة على البيئة الجارية. أداة حفظ المسودة تنص صراحةً أنها لا تطبق الإعدادات ولا تعيد تشغيل البيئة.
- الحالة الحالية: سياسة restricted مفعّلة، والمجالات المخصصة المطبقة فارغة. مسودة revision 3 تتضمن `binaries.prisma.sh` لكنها غير مطبقة.
- فحص حديث للرابط الفعلي لبصمة schema-engine المثبت أعاد HTTP 403. لم يُستخدم proxy بديل أو تعطيل TLS/checksum أو أي التفاف على الحجب.
- لذلك لم يُعَد توليد المحرك الأصلي أو تُنسب إليه نتائج الرحلة. يلزم تطبيق إعداد المجال من إعدادات Cloud، ثم التوليد القياسي وتشغيل الأداة المحلية دون متغيرات محرك JavaScript البديل. التفاصيل والأوامر في `organization-members-verification.md`.

## Migration الوحيدة

`supabase/migrations/20261107090000_organization_members_and_invitations.sql`

راجعت توافقها مع core schema وfunctions/triggers وRLS/grants الموجودة في الفرع:

- لا تضيف أو تحذف جداول أو أعمدة أو enums، ولا تغيّر Prisma schema أو migrations التاريخية. تستخدم UUIDs وorg_role والحقول الحالية والقيود الفريدة الموجودة.
- تستبدل جسم `private.guard_last_owner()` مع إبقاء توقيعها والـtrigger الأصلي؛ تضيف قفل صف المنشأة ومنع تغيير هوية العضوية، وتحافظ على استثناء حذف المنشأة نفسها عند cascade.
- تضيف `list_organization_members(uuid)` بإرجاع حقول الهوية والدور المطلوبة فقط بعد تحقق مستقل من العضوية، دون توسيع سياسة candidate_profiles أو users بصورة عامة.
- تضيف `accept_organization_invitation(text)` كمسار مضبوط الصلاحية لقبول غير العضو: يقرأ البريد المؤكد الحالي من auth.users، يقفل المنشأة والدعوة، يطابق البصمة والبريد والانتهاء، ثم يضيف العضوية ويحدّث وقت القبول في معاملة واحدة. لا يستبدل دور عضوية موجودة.
- تستخدم الدالتان SECURITY DEFINER وsearch_path فارغًا، وتمنع EXECUTE عن PUBLIC/anon وتمنحه للدور الموجود authenticated فقط. يلزم تطبيقها بمالك المخطط المعتاد القادر على قراءة auth.users والجداول؛ لا تمنح تطبيق الويب service_role أو BYPASSRLS.
- تسحب UPDATE المباشر على organization_invitations من authenticated. هذا تغيير سلوكي مقصود: القبول عبر الدالة فقط، والإلغاء بالحذف، ولا يمكن تمديد/تعديل الدعوة مباشرة بهذا الدور. أي عميل خارجي غير موجود بالمستودع يعتمد على UPDATE سيحتاج تكييفًا.
- لا تنفذ أوامر DML على الصفوف عند تطبيقها؛ INSERT/UPDATE داخل جسم دالة القبول يعملان عند استدعائها فقط. لا توجد إعادة كتابة أو حذف بيانات كجزء من التطبيق.
- ثبتت على PostgreSQL مخصص وعلى Supabase محلي معزول. تصحيح الوقت الأخير طُبّق على دالة القبول المحلية، ثم نجحت الرحلة المتصلة. اختبارات DB الحالية 12، ومنها انتهاء الدعوة أثناء انتظار القفل.

**بيانات الفريق:** لم تُتصل قاعدة الفريق أو الإنتاج ولم تُطبق Migration عليهما؛ لا أثر فعلي عليهما من هذه الجلسة. لا يمكن تأكيد توافق بياناتهما الحية أو انعدام انحراف مخططهما دون فحص منفصل مصرح به. عند أي تطبيق مستقبلي ستتغير الصلاحيات وسلوك الكتابة كما وُصف أعلاه، ولذلك لا يصح وصفها بأنها بلا أثر سلوكي مطلقًا.

## نطاق التغييرات

- داخل الميزة: APIs الأعضاء/الدعوات، SMTP، المصادقة المؤكدة للقبول، واجهة العضويات والقبول، العودة الثابتة بعد الدخول، الترجمات، Migration، الاختبارات وأدوات التحقق والتوثيق.
- مساحات مشتركة لكنها لازمة للميزة: AuthGuard يضيف معلومة emailConfirmed دون فرض شرط جديد على APIs القديمة؛ LoginForm وخادم signIn يدعمان وجهة ثابتة للدعوة عند طلبها فقط؛ app.module يسجل المكونات؛ ملفات الحزم تضيف SMTP/اختبارات دون ترقية إصدارات الحزم الموجودة في lockfile.
- **خارج النطاق الوظيفي للأعضاء:** تحويل layout العام إلى next/font/local وإضافة أصول الخطوط وتراخيصها وmanifest. هذا تغيير معتمد بطلب إصلاح Production Build، ويؤثر على الموقع كله. العائلات والأوزان ومتغيرات CSS محفوظة، وملفات Plex مطابقة للمصدر. حجم أصول الخطوط 1,741,280 بايت؛ لا توجد مقارنة أداء قبل/بعد أو ضمان تطابق بصري pixel-by-pixel مع مصدر Google السابق. نجح فحص تحميل الخطوط الفعلية في الإنتاج باللغتين.
- لا تغييرات في منطق الوظائف أو قرارات التوظيف، مهام/معايير التقييم، كتالوج المهارات، خدمات AI، سجل ALM، سكربت سدايا أو supabase/config.toml المشترك.
- الملفات المتجاهلة والمخرجات ومكونات Supabase وأدوات المحرك البديل تحت workspace خارج checkout ليست ضمن ملفات Git المقترحة، وتحتوي حالة اختبار محلية فقط. ملف status المحلي يحوي مفاتيح محلية ولا يجب إدراجه في Git أو نشره.

## الملاحظات العالية الأربع في npm audit

هذه أربعة **سجلات حزم متأثرة** في سلسلة واحدة، وليست أربع ثغرات جذرية مستقلة:

| الحزمة المثبتة | سبب تصنيفها عاليًا | الأثر العملي |
| --- | --- | --- |
| deepmerge-ts 7.1.5 | الثغرة الأصلية: دمج كائنات recursive يؤدي إلى stack exhaustion؛ النطاق المعلن أقل من 8.0.0 | احتمال توقف العملية/DoS إذا وصل graph متكرر غير آمن إلى الدمج |
| @prisma/config 6.19.3 | يعتمد على deepmerge-ts؛ يستورده في مسار إعداد Prisma | قد يتأثر تحميل/دمج إعداد Prisma والمهام التي تستخدمه |
| prisma 6.19.3 | يعتمد على @prisma/config | قد يتأثر CLI وcode generation/CI عند معالجة إعداد مؤثر |
| @prisma/client 6.19.3 | موسوم عبر علاقة peer بالحزمة prisma في شجرة audit | انتقال تصنيف الاعتمادية لا يثبت أن كل استعلام runtime يستدعي دالة الدمج المتأثرة |

المرجع: [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx)، CWE-674. لا توجد في تقرير audit درجة CVSS مفيدة أو إثبات RCE/تسريب بيانات، ولا أفترضهما. لم أجد في مسارات HTTP الحالية تمريرًا مباشرًا لمدخل المستخدم إلى deepmerge-ts؛ موضع الاستيراد الذي راجعته في @prisma/config خاص بالإعداد. هذا تقييم وصول ثابت وليس إثبات عدم قابلية الاستغلال.

نفس العدّ ونفس أسماء الحزم المتأثرة ظهرت عند تدقيق baseline c5cb1af بصورة منفصلة: 24 إجمالًا، 4 عالية، 17 متوسطة، 3 منخفضة، دون حرجة. لا إصدارات حزم سابقة تغيّرت في lockfile، ولا affected package جديدة أضيفت. يعرض audit fixAvailable=false للشجرة الحالية؛ وجود إصدار أحدث من deepmerge-ts خارج النطاق لا يعني إمكان ترقية سلسلة Prisma بلا اختبار توافق. لم تنفذ أي ترقية أو npm audit fix.

## نتائج مثبتة على النسخة الحالية

لم تُكرر جميع الاختبارات في مرحلة المراجعة لأن كود التنفيذ لم يتغير. النتائج التالية من جولة التحقق النهائية السابقة على الملفات نفسها:

| الفحص | النتيجة |
| --- | --- |
| API + SMTP محلي | 27 اختبارًا ناجحًا / 8 suites |
| DB/RLS/التزامن والانتهاء | 12 ناجحًا |
| متصفح الميزة المعزول | 8 ناجحة |
| وحدات الويب | 7 ناجحة |
| AI دون مزود حي | 23 ناجحة |
| الرحلة المحلية المتصلة | 8 checkpoints ناجحة بمحرك Prisma JS وPG adapter |
| بناء API وProduction Build للويب | ناجحان |
| TypeScript في المشروعين | ناجح |
| Production browser smoke | en/ar نجحا، خطوط فعلية محلية، دون طلبات خارجية |
| نزاهة الخطوط | بصمات 7 ملفات صحيحة؛ Plex مطابق للمصدر |
| Native Prisma | غير متحقق؛ حجب HTTP 403 مستمر |
| npm audit | فشل بسبب الملاحظات القديمة الموضحة، وليس فحصًا ناجحًا |

الفحوصات غير المكتملة: Native Prisma، الاختبارات العامة القديمة المرتبطة بملفات/حسابات الفريق (API E2E وjourneys وcharacters وforms)، وإرسال مزود بريد حقيقي. لم تُشغّل على الفريق ولم تُعطّل لتبدو ناجحة. يلزم إعداد fixtures وعناوين محلية صريحة للاختبارات القديمة، وإعداد SMTP معتمد وإذن استعمال متلقين حقيقيين لاختبار الإرسال الخارجي. تفاصيل القيود والفرق بين محرك JS والمحرك الأصلي محفوظة في organization-members-verification.md.

## حصر ملفات التنفيذ

القائمة التالية تغطي الملفات الـ52 الموجودة قبل إضافة تقرير المراجعة هذا. تصنيف «عام/بناء» هو التغيير الخارج وظيفيًا عن شاشة الأعضاء لكنه معتمد لمعالجة البناء؛ بقية الملفات داخل التنفيذ أو التكامل المشترك أو الاختبارات/التوثيق.

| الملف | التصنيف والغرض |
| --- | --- |
| `.env.example` | تكامل: متغيرات SMTP وسر الدعوات دون قيم سرية |
| `HANDOFF.md` | توثيق التسليم والقيود |
| `NEXT_SESSION_PROMPT.md` | توثيق الفرع والعمل المتبقي والاختبار المعزول |
| `PROJECT_STATUS.md` | توثيق حالة التنفيذ والتحقق |
| `apps/api/package.json` | تكامل: nodemailer واعتماديات اختبار PostgreSQL وأنواعها وأمر اختبار DB |
| `apps/api/src/app.module.ts` | تكامل: تسجيل Controller وMailer |
| `apps/api/src/auth/auth.guard.spec.ts` | اختبارات: أمان وسلوك الميزة/المصادقة أو SMTP |
| `apps/api/src/auth/auth.guard.ts` | تكامل مشترك: قراءة تأكيد البريد من Auth الموثوق |
| `apps/api/src/db/db.service.ts` | تكامل مشترك: حقل اختياري في نوع AuthUser فقط |
| `apps/api/src/organizations/invitation-mailer.spec.ts` | اختبارات: أمان وسلوك الميزة/المصادقة أو SMTP |
| `apps/api/src/organizations/invitation-mailer.ts` | ميزة: SMTP مستقل بمحتوى الدعوة ومعالجة الإخفاق |
| `apps/api/src/organizations/members.controller.spec.ts` | اختبارات: أمان وسلوك الميزة/المصادقة أو SMTP |
| `apps/api/src/organizations/members.controller.ts` | ميزة: عرض/تعديل/إزالة العضويات وإدارة/قبول الدعوات |
| `apps/api/src/organizations/members.http.spec.ts` | اختبارات: أمان وسلوك الميزة/المصادقة أو SMTP |
| `apps/api/test/members-db.test.mjs` | اختبارات: أمان وسلوك الميزة/المصادقة أو SMTP |
| `apps/web/e2e-members/members.spec.ts` | اختبارات: أمان وسلوك الميزة/المصادقة أو SMTP |
| `apps/web/e2e-members/stub-api.mjs` | اختبارات: متصفح وخادم fixture محلي معزول |
| `apps/web/package.json` | اختبارات: أمر Playwright المخصص دون ترقية حزم |
| `apps/web/playwright.members.config.ts` | اختبارات: متصفح وخادم fixture محلي معزول |
| `apps/web/src/app/[locale]/invitations/accept/page.tsx` | ميزة: صفحة قبول الدعوة |
| `apps/web/src/app/[locale]/layout.tsx` | عام/بناء: استضافة الخطوط المعتمدة محليًا |
| `apps/web/src/app/[locale]/login/page.tsx` | تكامل مشترك: وجهة العودة الثابتة للدعوة |
| `apps/web/src/app/[locale]/organization/[orgId]/members/loading.tsx` | ميزة: حالة تحميل مترجمة |
| `apps/web/src/app/[locale]/organization/[orgId]/members/page.tsx` | ميزة: صفحة الأعضاء مع بيانات وصلاحيات المنشأة |
| `apps/web/src/app/[locale]/organization/[orgId]/page.tsx` | ميزة: رابط أعضاء المنشأة فقط |
| `apps/web/src/components/accept-invitation.tsx` | ميزة: قراءة/مسح/استبدال fragment وقبول صريح |
| `apps/web/src/components/forms.tsx` | تكامل مشترك: حقل اختيار العودة للدعوة في LoginForm |
| `apps/web/src/components/members.tsx` | ميزة: عرض وتحكم العضويات والدعوات وحالات التغذية الراجعة |
| `apps/web/src/fonts/BricolageGrotesque.woff2` | عام/بناء: أصل خط معتمد أو ترخيصه/بصمته/توثيق مصدره |
| `apps/web/src/fonts/IBMPlexSans.ttf` | عام/بناء: أصل خط معتمد أو ترخيصه/بصمته/توثيق مصدره |
| `apps/web/src/fonts/IBMPlexSansArabic-Bold.ttf` | عام/بناء: أصل خط معتمد أو ترخيصه/بصمته/توثيق مصدره |
| `apps/web/src/fonts/IBMPlexSansArabic-Medium.ttf` | عام/بناء: أصل خط معتمد أو ترخيصه/بصمته/توثيق مصدره |
| `apps/web/src/fonts/IBMPlexSansArabic-Regular.ttf` | عام/بناء: أصل خط معتمد أو ترخيصه/بصمته/توثيق مصدره |
| `apps/web/src/fonts/IBMPlexSansArabic-SemiBold.ttf` | عام/بناء: أصل خط معتمد أو ترخيصه/بصمته/توثيق مصدره |
| `apps/web/src/fonts/NotoKufiArabic.woff2` | عام/بناء: أصل خط معتمد أو ترخيصه/بصمته/توثيق مصدره |
| `apps/web/src/fonts/README.md` | عام/بناء: أصل خط معتمد أو ترخيصه/بصمته/توثيق مصدره |
| `apps/web/src/fonts/bricolagegrotesque-OFL.txt` | عام/بناء: أصل خط معتمد أو ترخيصه/بصمته/توثيق مصدره |
| `apps/web/src/fonts/ibmplexsans-OFL.txt` | عام/بناء: أصل خط معتمد أو ترخيصه/بصمته/توثيق مصدره |
| `apps/web/src/fonts/ibmplexsansarabic-OFL.txt` | عام/بناء: أصل خط معتمد أو ترخيصه/بصمته/توثيق مصدره |
| `apps/web/src/fonts/manifest.json` | عام/بناء: أصل خط معتمد أو ترخيصه/بصمته/توثيق مصدره |
| `apps/web/src/fonts/notokufiarabic-OFL.txt` | عام/بناء: أصل خط معتمد أو ترخيصه/بصمته/توثيق مصدره |
| `apps/web/src/lib/auth-actions.ts` | تكامل مشترك: رجوع ثابت بعد تسجيل الدخول، دون open redirect |
| `apps/web/src/lib/member-actions.ts` | ميزة: Server Actions واستدعاء API وإعادة التحقق |
| `apps/web/src/messages/ar.json` | ميزة: نصوص عربية ورسالة فشل إرسال الدعوة |
| `apps/web/src/messages/en.json` | ميزة: نصوص إنجليزية ورسالة فشل إرسال الدعوة |
| `apps/web/tsconfig.json` | اختبارات: تضمين الأنواع المولدة لمجلد .next-members |
| `docs/organization-members-checklist.md` | توثيق التنفيذ أو التحقق أو التشك لست |
| `docs/organization-members-verification.md` | توثيق التنفيذ أو التحقق أو التشك لست |
| `docs/organization-members.md` | توثيق التنفيذ أو التحقق أو التشك لست |
| `package-lock.json` | تكامل: قفل الحزم الجديدة؛ إصدارات الحزم الموجودة لم تتغير |
| `scripts/verify-members-local.cjs` | اختبارات: رحلة متصلة على stack مخصص وعناوين loopback فقط |
| `supabase/migrations/20261107090000_organization_members_and_invitations.sql` | ميزة: Migration الوحيدة الموضحة أعلاه |

المراجعة متوقفة هنا بانتظار قرار المستخدم. لم ينفذ commit أو push أو merge، ولم يطبق أي تغيير على الفريق أو الإنتاج.
