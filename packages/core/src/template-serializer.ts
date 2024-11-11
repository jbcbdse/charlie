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
      let value = _get(params, key) ?? "";
      if (typeof value !== "string") {
        value = stringify(value);
      }
      template = template.replaceAll(fullMatch, value);
    });
    return template;
  }
}
