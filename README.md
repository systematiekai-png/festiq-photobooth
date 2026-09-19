# Festiq photobooth platform

Een echt werkend platform: photobooth-app (iPad / laptop / 360°-booth), webdashboard en gastengalerij.
Foto's en video's worden op de server opgeslagen (SQLite + bestanden), niet in de browser.

## Starten

    npm install
    ADMIN_PASSWORD=mijnwachtwoord npm start

- Dashboard: http://localhost:3000/admin
- Booth: http://localhost:3000/booth/<slug>  (link staat in het dashboard bij het evenement)
- Galerij voor gasten: http://localhost:3000/gallery/<slug>
- Download-pagina per foto (via QR): /p/<id>

Zonder ADMIN_PASSWORD is het wachtwoord `photobooth`. Verander dat altijd.

## Wat kan het

- Twee boothtypes per evenement: de **iPad-booth** (maakt altijd een fotostrip van 2, 3 of 4 foto's) en de **360°-booth** (video-opname, instelbare lengte)
- **Ontwerpen (fotostrip-kaders)**: 7 ingebouwde ontwerpen in de Festiq-huisstijl en een eigen ontwerpeditor (zie hieronder). Per evenement kies je in het dashboard welk ontwerp gebruikt wordt (gasten kiezen dit niet zelf)
- Huisstijl per evenement: kleur, welkomsttekst, tekst onderaan de foto
- Na het opslaan een QR-code: gasten downloaden de foto of video op hun eigen telefoon
- Dashboard: evenementen aanmaken/bewerken/verwijderen, statistieken, galerij, foto's verwijderen, ZIP- en CSV-export
- Publieke galerij met automatische verversing en diavoorstelling (`?slideshow`)
- Kioskmodus voor de booth: `/booth/<slug>?kiosk` (verbergt de knoppen, scherm blijft aan)

## Eigen ontwerpen maken

Ga in het dashboard naar **Ontwerpen** en klik op "+ Nieuw ontwerp" (of "Kopie maken en aanpassen" bij een ingebouwd ontwerp).

- Kaderkleur, achtergrondkleuren, ronde hoeken, kanteling en filmstrip-stijl
- Tekst onderaan de strip
- Stickers: kies uit de ingebouwde set (kroon, druppel, ster, hart, klaver, madelief, vlinder, strik, regenboog, wolk, bel, stip, maan, glinster) of upload je eigen PNG met transparante achtergrond. Sleep ze op het voorbeeld, pas grootte, draaiing en kleur aan
- Kies het ontwerp bij het evenement in het evenementformulier ("Ontwerp"). Het staat vast voor alle gasten

## 360°-booth: eigen muziek en videokaders

Ga in het dashboard naar **360° extra's**.

- **Muziek**: upload MP3, M4A, WAV of OGG (max. 25 MB). Kies bij een 360°-evenement één nummer; het wordt in een lus onder elke video gemixt (met fade-out) en klinkt ook door de speakers tijdens het opnemen. Gasten kunnen het geluid in het overzicht aan- en uitzetten.
- **Videokaders (filmstrips)**: upload een PNG/WebP met transparante achtergrond, bij voorkeur 1920x1080. Het wordt over de hele video gelegd. Er zijn ook twee ingebouwde kaders (Filmstrip en Festiq-kader). Zonder kader krijgt de video de gewone naambalk.
- **Automatische slow-motion**: de booth meet tijdens de opname waar de meeste beweging is en speelt dat stuk (1,5 tot 3 seconden) op halve snelheid af, met zachte in- en uitloop. Daarna wordt de video met kader en muziek opnieuw opgebouwd; dat duurt ongeveer zo lang als de video zelf. Uitzetten kan per evenement via "Bewerken". Op camera's die 60 beelden per seconde halen (zoals de iPad-achtercamera) oogt de slow-motion het vloeiendst.
- **Afspelen na de opname**: in het scherm na de opname kan de gast de video afspelen, pauzeren en via de tijdlijn heen en weer scrubben, en het geluid aanzetten voordat hij opslaat.
- Kies muziek en kader per evenement via "Bewerken" (alleen zichtbaar bij het type 360° booth).

## Online zetten met GitHub en Render (zonder terminal)

1. Ga in Render (render.com) naar New > Blueprint en kies deze GitHub-repo. Render leest `render.yaml` en zet alles goed.
2. Vul bij `ADMIN_PASSWORD` het wachtwoord in dat je voor het dashboard wilt gebruiken.
3. Na een paar minuten staat de photobooth op een `https://...onrender.com`-adres. Daar werkt de camera op de iPad, omdat het HTTPS is. Het dashboard staat op `/admin`.
4. Elke wijziging die je op GitHub zet, gaat daarna automatisch live.

Foto's, video's, muziek en de database staan op een blijvende schijf (`/data`, 10 GB). Die schijf hoort bij het Starter-plan van Render (betaald). Zonder schijf zou alles bij elke herstart verdwijnen. Draai je het zelf op een server, gebruik dan het meegeleverde `Dockerfile` en koppel een volume aan `/data`.

## Belangrijk voor iPad en telefoons

Browsers geven **alleen via HTTPS** (of localhost) toegang tot de camera. Voor een echte iPad-booth moet
het platform dus op een HTTPS-adres draaien. Opties:

1. Hosten (Railway, Render, Fly.io, een VPS met Caddy/Nginx). Dockerfile is meegeleverd. Koppel een
   persistent volume aan `/data`, anders verdwijnen foto's bij een herstart.
2. Tijdelijk testen met een tunnel: `npx cloudflared tunnel --url http://localhost:3000`
   en zet `PUBLIC_URL` op het getoonde adres.

Zet `PUBLIC_URL` zodat de QR-codes naar het publieke adres wijzen en niet naar localhost.

Tip voor iPad: open de booth in Safari, tik op Deel > "Zet op beginscherm" voor een app zonder adresbalk,
en gebruik Begeleide toegang (Guided Access) om de iPad te vergrendelen.
Voor 360°-booths: sluit de camera/iPad aan op het draaiplatform, kies "360° video" en stel de duur in.

## Techniek

Node.js 18+, Express, better-sqlite3, multer, qrcode, archiver. Geen build-stap.
Data staat in `DATA_DIR` (`photobooth.db` en `uploads/`), maak daar een back-up van.

## Huisstijl

De booth, het dashboard, de galerij en de downloadpagina gebruiken de Festiq-huisstijl (logo en kleuren: roze, oranje, paars, blauw op crème).
Het logo staat in `public/festiq-wordmark.jpg` en `public/festiq-logo.jpg`; vervang die bestanden om een ander logo te gebruiken.
