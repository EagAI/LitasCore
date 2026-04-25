# Lygiai ir XP (MakenBot)

Šis dokumentas aprašo, kaip serveryje skaičiuojami **lygiai**, **XP** ir susijusios taisyklės — pagal `index.js` viduje esančią `levelingConfig` ir funkcijas `getXpRequiredForLevel`, `getLevelFromXp`, `addXp`.

---

## Bendras principas

- Kiekvienas narys turi **bendrą sukauptą XP** (saugojama DB).
- Iš bendro XP apskaičiuojamas **lygis** (`getLevelFromXp`).
- XP galima gauti **tekstinėmis žinutėmis** ir **būnimu balso kanale** (pagal taisykles žemiau).

---

## Tekstinės žinutės (chat XP)

| Parametras | Reikšmė | Aprašymas |
|------------|---------|-----------|
| **XP už vieną „skaitomą“ žinutę** | `15` (`textXpPerMessage`) | Pridedama, kai žinutė praėjo ilgio ir cooldown filtrus. |
| **Minimalus žinutės ilgis** | `3` simboliai (`minMessageLength`) | Trumpesnės žinutės **negauna** XP (ir dažnai anksčiau nutraukiamas `messageCreate` apdorojimas). |
| **Cooldown (spam apsauga)** | `5000` ms = **5 sek.** (`spamCooldown`) | Tarp **dviejų XP duodančių** žinučių turi praeiti bent 5 sekundės (skaičiuojama pagal `lastMessageTime` žemėlapyje). |

Pastabos:

- Cooldown ir ilgis taikomi **per vartotoją** (ne visam kanalui).
- Jei žinutė per trumpa arba per greitai po ankstesnės — XP už tą žinutę **nėra** skiriamas; kita veikla (keyword, moderacija ir pan.) gali vykti pagal atskirus kodo blokus.

---

## Balsas (voice XP)

| Parametras | Reikšmė | Aprašymas |
|------------|---------|-----------|
| **XP už minutę balso kanale** | `8` (`voiceXpPerMinute`) | Pridedama už **pilnas prabėgusias minutes** nuo paskutinio „tick“ (žr. žemiau). |
| **Tikrinimo intervalas** | `60000` ms = **1 min.** (`voiceCheckInterval`) | Fonas periodiškai tikrina `voiceActivity` ir skaičiuoja, kiek minučių praėjo nuo `lastCheck`. |

Voice XP skaičiuojama tik tada, kai vartotojas yra **leistinuose** balso kontekstuose (pvz. savo sukurtos sesijos kanalas arba bendras balso kanalas kategorijoje — pagal `voiceStateUpdate` / `voiceSessions` logiką kode). Jei išeina iš balso arba kanalas nebegalioja, sekimas nutraukiamas.

---

## Lygio skaičiavimo formulė

Naudojami parametrai:

- `baseXpRequired` = **100**
- `levelUpMultiplier` = **1.3** (kiekvienam lygiui „žingsnis“ didėja — žr. formulę)

**Kumuliacinis XP iki lygio `L`** (funkcija `getXpRequiredForLevel(L)`):

- Lygis `1`: reikia **100** kumuliacinio XP (pradinė riba).
- Lygiai `L ≥ 1`: kumuliacinis XP = suma nuo `i = 1` iki `L`:

  \[
  \sum_{i=1}^{L} \left\lfloor 100 \times 1{,}3^{\,i-1} \right\rfloor
  \]

Kiekvienas lygis prideda vis didesnį **žingsnį** (suapvalinimą žemyn po daugybos).

**Lygis iš bendro XP** (`getLevelFromXp(xp)`): didinamas lygis, kol kumuliacinis slenkstis dar neviršytas; praktikoje — kiek „patirties lygių“ atitinka sukauptas XP (0 lygis galimas prieš pasiekus pirmą slenkstį).

---

## Lentelė: kumuliacinis XP ir XP „žingsnis“ (1–20 lygis)

| Lygis | Mažiausias kumuliacinis XP (`getXpRequiredForLevel`) | XP pridėta į šį lygį (žingsnis) |
|------:|-----------------------------------------------------:|--------------------------------:|
| 1 | 100 | 100 |
| 2 | 230 | 130 |
| 3 | 399 | 169 |
| 4 | 618 | 219 |
| 5 | 903 | 285 |
| 6 | 1274 | 371 |
| 7 | 1756 | 482 |
| 8 | 2383 | 627 |
| 9 | 3198 | 815 |
| 10 | 4258 | 1060 |
| 11 | 5636 | 1378 |
| 12 | 7428 | 1792 |
| 13 | 9757 | 2329 |
| 14 | 12785 | 3028 |
| 15 | 16722 | 3937 |
| 16 | 21840 | 5118 |
| 17 | 28494 | 6654 |
| 18 | 37144 | 8650 |
| 19 | 48389 | 11245 |
| 20 | 63008 | 14619 |

*(Skaičiai sutampa su `getXpRequiredForLevel` implementacija `index.js`.)*

---

## `/level check` ir progresas į kitą lygį

Komanda naudoja `getUserLevelInfo`: skaičiuojama, kiek XP jau **peržengta** dabartiniame lygyje ir kiek **reikia iki kito lygio**, bei **procentas** (`progressPercentage`) tarp šių ribų. UI gali rodyti tekstą arba vizualinę juostą — logika lieka ta pati.

---

## Duomenų bazė

Vartotojo įraše saugoma bent: `xp`, `level`, `total_messages`, `total_voice_time` ir pan. Lygis atnaujinamas po kiekvieno XP pakeitimo (`addXp`).

---

## Rolės už lygį (jei sukonfigūruota)

Jei administratorius naudoja **role-reward** / lygio apdovanojimus, jie valdomi atskirai (DB lentelė `level_rewards`) — šiame faile detalūs ID nenurodomi; žr. bot komandas ir serverio konfigūraciją.

---

## Keitimas be šio dokumento atnaujinimo

Visi skaičiai **kode** yra `levelingConfig` objekte ir gretimose funkcijose. Jei pakeisi `textXpPerMessage`, `spamCooldown`, `baseXpRequired` ar `levelUpMultiplier` — atnaujink ir šį failą arba laikyk jį orientaciniu.
