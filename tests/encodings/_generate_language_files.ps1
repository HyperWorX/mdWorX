# Generator for language / script test files. Run from anywhere:
#   pwsh -File _generate_language_files.ps1
# Idempotent. Existing files are overwritten.

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$utf8NoBom = New-Object System.Text.UTF8Encoding $false

function Write-Md([string]$name, [string]$content, $encoding) {
    [System.IO.File]::WriteAllText((Join-Path $dir $name), $content, $encoding)
}

# ---- UTF-8 files (most languages default to UTF-8) -----------------------

Write-Md 'arabic.md' @"
# مرحبا بالعالم

هذه فقرة باللغة العربية لاختبار عرض النص من اليمين إلى اليسار في المحرر.

- العنصر الأول
- العنصر الثاني
- العنصر الثالث

> اقتباس تجريبي
"@ $utf8NoBom

Write-Md 'hebrew.md' @"
# שלום עולם

זוהי פסקה בעברית לבדיקת רינדור טקסט מימין לשמאל בעורך.

- פריט ראשון
- פריט שני
- פריט שלישי

> ציטוט לבדיקה
"@ $utf8NoBom

Write-Md 'chinese-simplified.md' @"
# 你好世界

这是一段简体中文测试文本，用于检验字体回退和中日韩字符渲染。

- 第一项
- 第二项
- 第三项

> 引用块测试
"@ $utf8NoBom

Write-Md 'chinese-traditional.md' @"
# 歡迎使用

這是一段繁體中文測試文本，用於檢驗字型回退和中日韓字元渲染。

- 第一項
- 第二項
- 第三項

> 引用區塊測試
"@ $utf8NoBom

Write-Md 'japanese.md' @"
# こんにちは世界

これは日本語のテスト文書です。漢字、ひらがな、カタカナの混在をテストします。

- リスト項目一
- リスト項目二
- リスト項目三

> 引用ブロックのテスト
"@ $utf8NoBom

Write-Md 'korean.md' @"
# 안녕하세요 세계

이것은 한글 렌더링을 시험하기 위한 마크다운 문서입니다.

- 항목 하나
- 항목 둘
- 항목 셋

> 인용문 테스트
"@ $utf8NoBom

Write-Md 'thai.md' @"
# สวัสดีชาวโลก

นี่คือเอกสารทดสอบภาษาไทย เพื่อดูการแสดงผลของวรรณยุกต์และสระลอย รวมถึงการตัดคำที่ถูกต้อง

- รายการที่หนึ่ง
- รายการที่สอง
- รายการที่สาม

> คำพูดอ้างอิงเพื่อทดสอบ
"@ $utf8NoBom

Write-Md 'devanagari.md' @"
# नमस्ते दुनिया

यह देवनागरी लिपि का परीक्षण है। संयुक्ताक्षरों और मात्राओं की जाँच के लिए।

- पहला आइटम
- दूसरा आइटम
- तीसरा आइटम

> उद्धरण की जाँच
"@ $utf8NoBom

Write-Md 'greek.md' @"
# Γειά σου κόσμε

Αυτό είναι ένα έγγραφο δοκιμής στα ελληνικά. Μονοτονικό και πολυτονικό: ἀρχή, εἰρήνη, ὥρα, ψυχή.

- Πρώτο στοιχείο
- Δεύτερο στοιχείο
- Τρίτο στοιχείο

> Παράθεμα για δοκιμή
"@ $utf8NoBom

Write-Md 'emoji.md' @"
# Emoji rendering test 🎨

Basic: 🌍 🚀 ⭐ 🎉 🐉 🦊

Skin tones (Fitzpatrick): 👋 👋🏻 👋🏼 👋🏽 👋🏾 👋🏿

ZWJ sequences: 👨‍👩‍👧 👩‍💻 👨‍🔬 🧑‍🚀 🏳️‍🌈 🏴‍☠️

Flags (regional indicator pairs): 🇯🇵 🇺🇸 🇦🇺 🇪🇺 🇮🇸 🇰🇷

Symbols outside the emoji range: ™ ® © ℃ ℉ ∞ ∑ √ ≈
"@ $utf8NoBom

Write-Md 'mixed-bidi.md' @"
# Bidirectional text test

This paragraph is in English, then switches to Arabic mid-sentence مرحبا بالعالم and back to English. The bidirectional algorithm should handle the script boundaries correctly without visual artefacts.

Hebrew embedded: today's lesson is שלום עולם, which translates to "hello world" in English.

- English list item one
- العنصر الثاني بالعربية
- פריט שלישי בעברית
- English list item four

> A quote with mixed content: the phrase العربية means "Arabic" and is the native name for the language.
"@ $utf8NoBom

# ---- Native (non-UTF-8) encodings ---------------------------------------
# Same content as the UTF-8 versions, encoded in the language's legacy
# Windows codepage. Exercises the encoding-decode paths in native.

$jpContent = @"
# こんにちは世界

これは日本語のテスト文書です。漢字、ひらがな、カタカナの混在をテストします。

- リスト項目一
- リスト項目二
- リスト項目三

> 引用ブロックのテスト
"@

$cnContent = @"
# 你好世界

这是一段简体中文测试文本，用于检验字体回退和中日韩字符渲染。

- 第一项
- 第二项
- 第三项

> 引用块测试
"@

$krContent = @"
# 안녕하세요 세계

이것은 한글 렌더링을 시험하기 위한 마크다운 문서입니다.

- 항목 하나
- 항목 둘
- 항목 셋

> 인용문 테스트
"@

Write-Md 'shift-jis.md' $jpContent ([System.Text.Encoding]::GetEncoding(932))
Write-Md 'gbk.md'       $cnContent ([System.Text.Encoding]::GetEncoding(936))
Write-Md 'euc-kr.md'    $krContent ([System.Text.Encoding]::GetEncoding(949))

Get-ChildItem $dir -Filter '*.md' | Sort-Object Name | Format-Table Name, Length -AutoSize
