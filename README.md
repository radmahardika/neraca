# Neraca Bapok Nasional

Dashboard web statis untuk neraca komoditas bahan pokok (bapok) per provinsi:

- **Peta surplus/defisit**: lingkaran hijau (surplus) dan merah (defisit); ukurannya mengikuti besar neraca.
- **Rekomendasi distribusi**: provinsi defisit terbesar dipasok lebih dulu dari provinsi surplus terdekat. Alurnya digambar di peta.
- **Neraca provinsi**: tabel yang bisa diurutkan; klik baris untuk memperbesar peta ke provinsi itu.
- **Harga** dan **Pelaku Usaha**: dimuat dari sheet `Harga` dan `Pelaku Usaha` jika sheet itu ada.

## Sumber data

Data dibaca langsung dari [Google Sheets](https://docs.google.com/spreadsheets/d/1qximmc_hwlZ-_UuYao45VDJ5XU-YwSF22ZYPOayO7pY/edit).
Satu sheet untuk tiap komoditas: Cabai Rawit, Cabai Merah, Bawang Merah, Telur Ayam, Daging Ayam, Daging Sapi.
Perubahan di spreadsheet langsung tampil di dashboard. Jika Google Sheets tidak bisa diakses,
dashboard memakai salinan di `data/snapshot.js`.

Sheet opsional (baris pertama = nama kolom):

| Sheet | Kolom |
|---|---|
| `Harga` | provinsi, komoditas, harga, tanggal |
| `Pelaku Usaha` | provinsi, komoditas, nama, jenis, kontak |

- Nama provinsi dan komoditas harus sama persis dengan sheet neraca (mis. `DI Yogyakarta`, `Cabai Rawit`).
- Harga boleh ditulis `45000`, `45.000`, atau `Rp 45.000`. Jika satu provinsi punya beberapa baris harga, baris paling bawah dianggap terbaru.
- Format kolom `kontak` sebagai teks (Format → Angka → Teks biasa) supaya angka 0 di depan nomor telepon tidak hilang.

## Menjalankan

Buka `index.html` di browser, atau aktifkan **GitHub Pages** (Settings → Pages → Branch `main`, folder `/`).
