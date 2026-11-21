# SAN HYDRO ENERGY HRM

Login-parol, telefon kamerasida yuz tanish, GPS bilan ishxona hududini tekshirish, davomat, oylik, KPI, ishga qabul.
Tashqi paketlar kerak emas. Faqat **Node.js 22.5 yoki yangisi**.

## 1. Kompyuteringizda sinab ko'rish
```
npm start
```
Brauzerda `http://localhost:3000` ni oching. Birinchi ishga tushishda terminalda administrator logini (`admin`) va paroli chiqadi. Uni saqlab qo'ying.
Parolni o'zingiz belgilash uchun: `ADMIN_PASSWORD=sizning_parolingiz npm start` (faqat birinchi ishga tushishda ishlaydi).

Kamera va GPS faqat **https://** manzilda (yoki localhost) ishlaydi. Telefon uchun serverni internetga joylashtiring.

## 2. Internetga joylashtirish (Render.com)
1. Bu papkani GitHub'ga yuklang (yangi private repository).
2. render.com'da ro'yxatdan o'ting, **New > Web Service** bosing va repository'ni tanlang.
3. Sozlamalar: Runtime `Node`, Build Command bo'sh yoki `echo ok`, Start Command `npm start`.
4. **Environment** bo'limida ikkita o'zgaruvchi qo'shing: `ADMIN_PASSWORD` (kuchli parol) va `NODE_VERSION` = `22`.
5. **MUHIM: ma'lumotlarni saqlash.** Bepul tarifda disk doimiy emas: server qayta ishga tushsa, barcha xodimlar va davomat **o'chib ketadi**. Real foydalanish uchun pullik tarifni tanlab, **Disk** qo'shing (Mount Path: `/var/data`) va `DATA_DIR=/var/data` muhit o'zgaruvchisini yozing.
6. Deploy tugagach, Render bergan `https://...onrender.com` manzilini oching.
Railway yoki o'z serveringiz (VPS) bo'lsa ham xuddi shunday: `npm start` va doimiy papka uchun `DATA_DIR`.

Ma'lumotlarning zaxira nusxasini admin **Sozlama > Zaxira nusxa** orqali yuklab oling (muntazam qiling).

## 3. Birinchi sozlash (administrator)
1. `admin` bilan kiring, **Sozlama > Parolni almashtirish**.
2. **Ishxona joylashuvi**: ishxonada turib "Hozirgi joylashuvimni ishlatish" ni bosing, masofani (masalan 150 m) yozing, saqlang.
3. **Xodimlar > + Xodim**: ma'lumot va boshlang'ich parol kiriting. Xodim logini avtomatik tabel raqami bo'ladi (SHE-001...).
4. Xodim qatorida **Yuzni ro'yxatga olish** ni bosing, xodim kameraga qaraydi, saqlang.
5. Xodimlarga manzilni, tabel raqamini va parolini bering.

## 4. Xodim qanday ishlaydi
Telefon brauzerida manzilni oching, tabel raqami va parol bilan kiring, **Kirish / chiqishni qayd qilish** ni bosing. Dastur yuzni kamerada tanib oladi, GPS ni oladi va faqat ishxona hududida, yuzi mos kelsa qayd qiladi. Birinchi qayd kirish, ikkinchisi chiqish.

## 5. Telefonga dastur sifatida o'rnatish (APK o'rniga)
Bu sahifa PWA: Android Chrome'da sahifani ochib, menyudan **"Ilovani o'rnatish"** yoki **"Bosh ekranga qo'shish"** ni tanlang. Telefonda oddiy ilova kabi, o'z ikonkasi bilan ochiladi. iPhone Safari'da: **Ulashish > Bosh ekranga qo'shish**.
Haqiqiy `.apk` fayl kerak bo'lsa, server https manziliga chiqqandan keyin pwabuilder.com saytida manzilni kiritib Android paketini yaratishingiz mumkin (Google Play uchun alohida hisob kerak).

## 6. Ishga qabul
Nomzodlarga `https://sizning-manzil/apply` havolasini bering. Nomzod ma'lumotini, manzilini, joylashuvini (GPS) va yuz rasmini yuboradi. HR **Qabul** bo'limida ko'radi: joylashuv Google Maps'da ochiladi. "Xodim qilish" nomzodning rasmi va yuzini xodim profiliga o'tkazadi.

## Ma'lumotlar qayerda saqlanadi
`DATA_DIR/hrm.db` (SQLite fayl): xodimlar, parollar (shifrlangan, scrypt), yuz vektorlari, nomzodlar (manzil, GPS, rasm), davomat. Yuz vektori xodimga ham, API orqali HR'ga ham qaytarilmaydi.

## Cheklovlar (bilib qo'ying)
- Yuz tanish telefon brauzerida (face-api, modellar jsDelivr'dan yuklanadi, birinchi marta 20-30 soniya). Bu **jonli odam tekshiruvi (liveness) emas**: yuqori sifatli rasm yoki video bilan aldash mumkin. Kerak bo'lsa keyinroq qo'shiladi.
- Soxta GPS dasturlarini to'liq to'xtatib bo'lmaydi.
- Yuz va joylashuv biometrik/shaxsiy ma'lumot hisoblanadi. Xodimlardan yozma rozilik oling va O'zbekistonning shaxsiy ma'lumotlar to'g'risidagi qonuniga mos ekanini tekshiring.
- Oylik hisobi namunaviy formulalarga asoslangan. Yakuniy summani buxgalter tekshirsin.
