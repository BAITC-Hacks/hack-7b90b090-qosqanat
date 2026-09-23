import type { Decision, Language } from "@voice/contracts";
const numberWords = new Set(
  "ноль нуль один одна одно два две три четыре пять шесть семь восемь девять десять одиннадцать двенадцать тринадцать четырнадцать пятнадцать шестнадцать семнадцать восемнадцать девятнадцать двадцать тридцать сорок пятьдесят шестьдесят семьдесят восемьдесят девяносто сто двести триста четыреста пятьсот шестьсот семьсот восемьсот девятьсот тысяча тысячи тысяч плюс нөл бір екі үш төрт бес алты жеті сегіз тоғыз он жиырма отыз қырық елу алпыс жетпіс сексен тоқсан жүз мың zero one two three four five six seven eight nine ten plus".split(
    " ",
  ),
);
const confirmations = new Set(
  "да нет иә жоқ дұрыс верно всё все подтверждаю растаймын yes no confirm please ок окей хорошо жақсы спасибо рақмет рахмет".split(
    " ",
  ),
);
export function languageChoice(
  text: string,
  decision: Decision,
  current: Language,
  samples: Language[] = [],
  preference?: Language,
) {
  const v = text.toLowerCase().trim();
  const request =
    /(?:говор|отвеч|обща|перей|давай|можно|пожалуйста|хочу|сөйле|жауап|айтыңыз|speak|answer|please)/u.test(
      v,
    );
  const kk =
    /(?:по[- ]казахски|на казахском|қазақша|қазақ тілінде|kazakh)/u.test(v);
  const ru = /(?:по[- ]русски|на русском|орысша|орыс тілінде|russian)/u.test(v);
  const shortChoice =
    /^(?:қазақша|орысша|по[- ]казахски|по[- ]русски|на русском|на казахском)[.!\s]*$/u.test(
      v,
    );
  const requested: Language | undefined =
    (request || shortChoice) && kk !== ru ? (kk ? "kk" : "ru") : undefined;
  const words = v.match(/[а-яәіңғүұқөһa-z]+/giu) || [];
  const trivial =
    !words.length ||
    words.every((w) => numberWords.has(w)) ||
    words.every((w) => confirmations.has(w));
  const history =
    trivial || requested
      ? samples
      : [...samples, decision.reply_language].slice(-3);
  const pinned = requested || preference;
  const ruCount = history.filter((x) => x === "ru").length,
    kkCount = history.length - ruCount;
  return {
    language:
      pinned ||
      (ruCount === kkCount
        ? history.at(-1) || current
        : ruCount > kkCount
          ? "ru"
          : "kk"),
    samples: history,
    preference: pinned,
  };
}
