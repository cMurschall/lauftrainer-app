<template>
  <article class="legal-page">
    <RouterLink class="legal-back" to="/">← LaufTrainer</RouterLink>
    <p class="eyebrow">RECHTLICHES</p>
    <h1>Datenschutzerklärung</h1>
    <p class="legal-muted">Stand: August 2026</p>

    <section>
      <h2>1. Verantwortlicher</h2>
      <p>
        Verantwortlich für die Verarbeitung personenbezogener Daten ist Christian Murschall,
        Ostpreußenweg 2, 24257 Hohenfelde, Deutschland.
        Kontakt: <a href="mailto:christian.murschall@googlemail.com">christian.murschall@googlemail.com</a>
      </p>
    </section>

    <section>
      <h2>2. Grundprinzip von LaufTrainer</h2>
      <p>
        LaufTrainer ist als local-first Trainingsanwendung konzipiert. Trainingshistorie,
        Ziele, Einstellungen und Analyseergebnisse werden grundsätzlich lokal im Browser in
        IndexedDB und teilweise im LocalStorage gespeichert. Es gibt keinen automatischen
        Upload deiner lokalen Trainingsdaten.
      </p>
    </section>

    <section>
      <h2>3. Hosting und technische Bereitstellung</h2>
      <p>
        Die Webanwendung wird über Cloudflare Pages bereitgestellt. Für Backend-Funktionen
        werden Cloudflare Workers, KV und D1 verwendet. Beim Aufruf können technisch notwendige
        Verbindungs- und Serverdaten verarbeitet werden, insbesondere IP-Adresse, Zeitpunkt,
        aufgerufene Ressource und technische Browserdaten. Die Verarbeitung dient der sicheren
        Bereitstellung, Fehleranalyse und Abwehr von Missbrauch.
      </p>
    </section>

    <section>
      <h2>4. Strava und Polar</h2>
      <p>
        Wenn du Strava oder Polar verbindest, wirst du zur jeweiligen Plattform weitergeleitet.
        Die Verbindung erfolgt nur nach deiner ausdrücklichen Aktion über OAuth. Der Backend-
        Dienst verarbeitet die dafür erforderlichen OAuth-Daten und speichert eine zeitlich
        begrenzte, gerätespezifische Sitzung. Importierte Trainingsdaten werden anschließend
        lokal in deiner LaufTrainer-Installation gespeichert.
      </p>
      <p>
        Für die Verarbeitung gelten zusätzlich die Datenschutzerklärungen von
        <a href="https://www.strava.com/legal/privacy" target="_blank" rel="noreferrer">Strava</a>
        und
        <a href="https://www.polar.com/en/legal/privacy-notice" target="_blank" rel="noreferrer">Polar</a>.
      </p>
    </section>

    <section>
      <h2>5. KI-Trainingsplan</h2>
      <p>
        Ein KI-Trainingsplan wird nur erstellt, wenn du ihn aktiv anforderst und der Übertragung
        zustimmst. Dafür wird eine verdichtete Trainingszusammenfassung an Google Gemini über
        das LaufTrainer-Backend übermittelt. Die vollständige lokale Trainingsdatenbank wird
        dabei nicht automatisch übertragen. Für Google-Dienste gilt zusätzlich die
        <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Datenschutzerklärung von Google</a>.
      </p>
    </section>

    <section>
      <h2>6. Credits und Zahlungen</h2>
      <p>
        Für Credits wird ein gerätespezifisches Wallet verwendet. Zahlungsabwicklungen können
        über Paddle erfolgen. Dabei verarbeitet Paddle die für die Zahlung erforderlichen Daten
        als eigenständiger Zahlungsdienstleister. Es gelten ergänzend die
        <a href="https://www.paddle.com/legal/privacy" target="_blank" rel="noreferrer">Datenschutzinformationen von Paddle</a>.
      </p>
    </section>

    <section>
      <h2>7. Deine Rechte</h2>
      <p>
        Du hast im Rahmen der gesetzlichen Voraussetzungen das Recht auf Auskunft, Berichtigung,
        Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch. Für
        Anfragen genügt eine E-Mail an
        <a href="mailto:christian.murschall@googlemail.com">christian.murschall@googlemail.com</a>.
        Du kannst lokale Daten außerdem jederzeit direkt in den Einstellungen von LaufTrainer
        löschen.
      </p>
    </section>
  </article>
</template>
