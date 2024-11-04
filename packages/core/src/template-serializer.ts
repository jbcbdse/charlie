import _get from "lodash.get";
import { stringify } from "yaml";
export class TemplateSerializer {
  public serialize(template: string, params: unknown): string {
    const matches = template.matchAll(/\{\{(.+?)\}\}/g);
    if (!matches) {
      return template;
    }
    [...matches].forEach((match) => {
      const [fullMatch, key] = match;
      const value = stringify(_get(params, key) ?? "");
      template = template.replaceAll(fullMatch, value);
    });
    return template;
  }
}
