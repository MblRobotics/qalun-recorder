# تسجيل القرآن برواية قالون · Qalun Recorder

**الرابط / Link: https://mblrobotics.github.io/qalun-recorder/**

<div dir="rtl">

## ما هذا؟

صفحة بسيطة تفتحها على هاتفك لتسجّل نفسك وأنت تقرأ آيات من القرآن الكريم **برواية قالون عن نافع**، آيةً آية. تُستعمل هذه التسجيلات لتعليم برنامجٍ مجانيٍّ غير ربحي يستمع إلى التلاوة برواية قالون ويساعد على المراجعة.

## كيف تسجّل؟

1. افتح الرابط في **Chrome** (أندرويد) أو **Safari** (آيفون)، وليس من داخل واتساب أو فيسبوك.
2. اكتب اسمك أو كنيتك، واختر طريقة القراءة:
   - **أقرأ بقالون**: اقرأ الآية كما هي مكتوبة.
   - **تمرين حفص**: اقرأ الكلمة الملوّنة برواية حفص عمدًا (تظهر تحت الآية)، وباقي الآية كما هو. هذا يعلّم البرنامج التفريق بين الروايتين.
3. اسمح للمتصفح باستعمال الميكروفون.
4. لكل آية: اضغط **سجّل**، اقرأ الآية، ثم اضغط **إيقاف**. يمكنك أن **تستمع** أو **تعيد التسجيل**، ثم اضغط **التالي**. إن لم تعرف الآية اضغط **تخطَّ**.
5. نصائح: مكان هادئ، الهاتف على بعد ٢٠–٣٠ سم، قراءة بسرعتك العادية، آية واحدة في كل تسجيل. لا بأس بالإعادة.
6. عند الانتهاء اضغط **إرسال التسجيلات**: يُجمع كل شيء في ملف ZIP واحد. اختر «مشاركة» أو «تنزيل الملف» ثم أرسله إلى صاحب المشروع (في واتساب: إرفاق ← مستند).
7. بعد أن تتأكد من وصول الملف اضغط «نعم، تم». بعدها فقط يمكن بدء «جلسة جديدة» تحذف التسجيلات من هاتفك.

## الخصوصية

- **لا يخرج أي شيء من هاتفك حتى تشارك ملف ZIP بنفسك.** لا حساب ولا تسجيل دخول ولا خادم ولا إحصاءات.
- تُحفظ التسجيلات داخل المتصفح على هاتفك (IndexedDB)، فلا تضيع إن أُغلقت الصفحة أو أُعيد تحميلها.
- الصفحة لا تطلب أي شيء من الإنترنت سوى ملفاتها هي (الخط والنص مضمّنان في المستودع).
- يحتوي الملف المُرسَل على: الاسم الذي كتبته (حروف وأرقام فقط)، والفئة العمرية والجنس إن اخترتهما، ونوع المتصفح، والتسجيلات.

## الترخيص للبيانات

بإرسالك ملف التسجيلات فإنك **تهبها لصاحب المشروع** لاستعمالها في تدريب واختبار نماذج التعرّف على التلاوة لتطبيقٍ **مجانيٍّ غير ربحي**. لن تُباع التسجيلات. إن أردت حذف تسجيلاتك لاحقًا فراسل صاحب المشروع.

</div>

---

## What it is

A small offline-capable web page that volunteers open on their phone to record themselves reciting Qur'an ayahs **in the Qalun riwaya**, one ayah per recording. The recordings are training and test data for a speech model in a free, non-profit Qur'an recitation app.

Two modes:

- **أقرأ بقالون (read Qalun)**: the ayah as written in the Qalun mushaf.
- **تمرين حفص (Hafs drill)**: the words where Qalun and Hafs differ are highlighted and the Hafs form is shown under the ayah; the reader says those words the Hafs way on purpose. Each such recording is a known Hafs reading of known words (negative examples for the Qalun model).

Ayah order: first the ayahs with Qalun-vs-Hafs differences (shuffled per reader, deterministic by name), then all others; ayahs over 40 words are skipped. The Hafs drill uses the same order restricted to ayahs with differences, so one reader produces paired Qalun/Hafs takes of the same ayahs.

## How to record

Open the link in Chrome (Android) or Safari (iPhone), enter a name, choose a mode, allow the microphone, then for each ayah: record, stop, optionally play back or re-record, next (or skip). Quiet room, phone 20-30 cm away, normal pace, one ayah per recording. Re-recording is fine. When done, tap «إرسال التسجيلات» to build one ZIP and share or download it.

## Privacy

Nothing leaves the phone until you share the ZIP yourself. No login, no backend, no analytics, no third-party requests: the font, the text and all code are served from this repository. Recordings are kept in the browser's IndexedDB so a reload or crash loses nothing; «جلسة جديدة» (new session) only deletes recordings after you confirmed a successful export.

## Data licence

By sending the ZIP, the reader gives the recordings to the project owner for training and evaluating recitation-recognition models for a free, non-profit app. Recordings are not sold. Readers can ask the owner to delete their recordings.

## Export format

`<name>_<YYYYMMDD-HHMM>.zip` contains `<name>_<YYYYMMDD-HHMM>/manifest.json` and `audio/<name>_<SSS>_<AAA>_<mode>_<take>.wav` (16 kHz, mono, 16-bit PCM; captured with echo cancellation, noise suppression and auto gain off, resampled in the browser with a windowed-sinc filter). `mode` is `qalun` or `hafs`. The manifest holds the app version, reader name and optional age range and gender, the mode, the browser user agent, the microphone track settings, and per file: surah, ayah, `ayah_id` (1..6214, Madani count), mode, take, `kept` (since 1.1.0: `true` for the one take per ayah and mode to use, the reader's choice or else the last take; other takes of the same ayah are extra attempts), the Qalun ayah text, `drift_words` targeted in the Hafs drill (`loc` "s:a:w", `qalun`, `hafs`, `class`), duration, sample rate, `recorded_at`, peak and RMS (linear and dBFS), clipped fraction and the input sample rate. Takes shorter than 0.8 s or without sound (peak below -45 dBFS) are not saved.

## Development

```
node scripts/build-data.mjs [path/to/ertak/scripts/data/qaloun]   # regenerate data/quran.json
npm test                                                          # unit tests (Node 20+)
npm install && npm run smoke                                      # headless Chrome + fake microphone
node scripts/serve.mjs 8080                                       # local server
```

No framework and no runtime dependencies; `playwright-core` is a dev dependency for the smoke test only (it drives the installed Google Chrome).

Text: the KFGQPC Qalun text with the basmala stripped from ayah 1 (except surah 9); drift table from the ertak project's `farsh.hafs.json` (classes consonant, hamza, long_vowel, vowel).

## Font licence

`vendor/fonts/qalun.ttf` is the **KFGQPC Qaloun Uthmanic Script** font by the King Fahd Glorious Quran Printing Complex, unmodified, taken from release v3.1.0 of QUD-Technologies/quranic-universal-audio. Its embedded licence grants free use, copying and distribution, and forbids selling or modifying it; see `vendor/fonts/qalun.LICENSE.txt`. The font is not covered by this repository's MIT licence.

Code: MIT (see `LICENSE`).
