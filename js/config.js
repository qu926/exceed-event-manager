window.EVENT_MANAGER_CONFIG = {
  // GitHub Pagesのリポジトリ名と揃えています。
  appId: "exceed-event-manager",

  // EXCEEDのブランド設定です。
  producerName: ".EXE PRODUCE",
  producerLogoPath: "./assets/exe-produce-logo.png",
  brandName: "EXCEED",
  title: "EXCEED 勤怠・予約管理",
  eyebrow: "EXCEED Event Manager",
  logoPath: "./assets/exceed-logo.png",
  logoAlt: "EXCEED ロゴ",
  groupStores: ["EXCEED", "SYNDICATE", "THE CENTRAL"],

  // 安全な既定値として、このブラウザ内だけに保存します。
  storageMode: "local",
  supabaseUrl: "PASTE_SUPABASE_PROJECT_URL_HERE",
  supabaseAnonKey: "PASTE_SUPABASE_ANON_PUBLIC_KEY_HERE",
  // Supabaseを使う場合は、イベントごとに重複しない行IDへ変更してください。
  stateRowId: "exceed-event-manager",

  // core.jsが生成する初期データをイベント向けに差し替えます。
  core: {
    sitePassword: "exceed",
    adminPassword: "exceed2026",
    // 0=日曜日 ... 4=木曜日
    eventWeekdays: [4],
    reservationOpenWeekday: 3,
    reservationOpenTime: "22:00",
    firstWeekHolidayCandidates: false,
    grandOpenDate: "2026-07-02",
    preOpenEventNote: "グランドオープン前の練習会",
    grandOpenEventNote: "グランドオープン",
    initialRoles: ["幹部", "ホスト", "体入"],
    initialUsers: [
      {
        id: "u_exceed_manager",
        display_name: "EXCEED運営",
        kana: "えくしーどうんえい",
        role: "幹部",
      },
    ],
  },
};
