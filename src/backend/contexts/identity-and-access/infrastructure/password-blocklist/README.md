# Common-password blocklist

`common-passwords.data.js` (one newline-separated string) is derived from `10_million_password_list_top_1M.txt` in
[OWASP SecLists](https://github.com/danielmiessler/SecLists) (Daniel Miessler,
Jason Haddix), licensed **CC BY-SA 3.0**. Derivation: first 100,000 lines → keep
length ≥ 8 → lower-case → de-duplicate (≈38k entries). This derived list is
redistributed under the same licence.

Regenerate:

    head -n 100000 10_million_password_list_top_1M.txt | tr -d '\r' \
      | awk 'length($0)>=8' | tr 'A-Z' 'a-z' | awk '!seen[$0]++' > list.txt && node -e "require('fs').writeFileSync('common-passwords.data.js', 'export default ' + JSON.stringify(require('fs').readFileSync('list.txt','utf8').trim()) + ';\\n')"
