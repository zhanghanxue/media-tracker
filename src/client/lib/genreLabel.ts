// Display labels for genres. The DB stores ONE canonical name per genre
// concept, in Chinese (worker/sources/genres.ts § CANONICAL_ZH + migration
// 0011); this maps that stored value to an English label when the UI language
// is English. zh mode shows the stored value verbatim. Anything unmapped
// (including the English leftovers that have no Chinese form — MOBA, 4X, …)
// falls back to the stored value in both languages.
//
// Keep in sync with CANONICAL_ZH (its reverse, one preferred label per name)
// plus the Bangumi whitelist's Chinese-only genres (bangumi-mapper.ts).

import type { UiLang } from "./types";

const GENRE_EN: Record<string, string> = {
  // Reverse of CANONICAL_ZH (preferred label where several names merged)
  动作: "Action",
  冒险: "Adventure",
  喜剧: "Comedy",
  剧情: "Drama",
  奇幻: "Fantasy",
  恐怖: "Horror",
  悬疑: "Mystery",
  爱情: "Romance",
  科幻: "Sci-Fi",
  惊悚: "Thriller",
  音乐: "Music",
  犯罪: "Crime",
  历史: "History",
  战争: "War",
  家庭: "Family",
  纪录片: "Documentary",
  西部: "Western",
  动画: "Animation",
  传记: "Biography",
  日常: "Slice of Life",
  运动: "Sports",
  超自然: "Supernatural",
  心理: "Psychological",
  机甲: "Mecha",
  魔法少女: "Mahou Shoujo",
  角色扮演: "RPG",
  射击: "Shooter",
  格斗: "Fighting",
  平台跳跃: "Platformer",
  解谜: "Puzzle",
  竞速: "Racing",
  模拟: "Simulation",
  策略: "Strategy",
  战术: "Tactical",
  街机: "Arcade",
  视觉小说: "Visual Novel",
  独立: "Indie",
  砍杀: "Hack and Slash",
  点击冒险: "Point-and-Click",
  生存: "Survival",
  潜行: "Stealth",
  沙盒: "Sandbox",
  开放世界: "Open World",
  动作冒险: "Action & Adventure",
  科幻奇幻: "Sci-Fi & Fantasy",
  真人秀: "Reality",
  脱口秀: "Talk Show",
  儿童: "Kids",
  肥皂剧: "Soap",
  // Bangumi whitelist genres with no English-source counterpart
  魔幻: "Magic",
  推理: "Deduction",
  搞笑: "Gag",
  恋爱: "Love",
  校园: "School",
  青春: "Youth",
  治愈: "Healing",
  热血: "Hot-Blooded",
  战斗: "Battle",
  竞技: "Competitive",
  歌舞: "Song & Dance",
  美食: "Gourmet",
  职场: "Workplace",
  悬幻: "Mystic Fantasy",
  武侠: "Wuxia",
  仙侠: "Xianxia",
  古装: "Costume Drama",
  侦探: "Detective",
  机战: "Mecha Battle",
  后宫: "Harem",
  百合: "Yuri",
  耽美: "BL",
  乙女: "Otome",
  伦理: "Ethics",
  社会: "Social",
  奇幻冒险: "Fantasy Adventure",
};

/** The stored (canonical Chinese) genre value → what the current UI shows. */
export function genreLabel(value: string, lang: UiLang): string {
  if (lang === "zh") return value;
  return GENRE_EN[value] ?? value;
}
