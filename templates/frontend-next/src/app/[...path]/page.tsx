import { Blocks } from "@django-stack/react";
import { captchaEnabled } from "@django-stack/utils";
import type { Metadata } from "next";
import { ContactForm } from "@/components/ContactForm";
import { getContent, notFoundOrRedirect, pageMetadata } from "@/lib/api";

type Props = { params: Promise<{ path: string[] }> };

async function load(params: Props["params"]) {
  const path = (await params).path.join("/");
  return { path, page: await (await getContent()).getPage(path) };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { path, page } = await load(params);
  return page ? pageMetadata(page, `/${path}`) : {};
}

export default async function ContentPage({ params }: Props) {
  const { path, page } = await load(params);
  if (!page) return notFoundOrRedirect(`/${path}`);
  return (
    <article className="narrow">
      <h1>{page.title}</h1>
      <Blocks blocks={page.body} />
      {page.path === "contact" ? <ContactForm captcha={captchaEnabled(process.env.CAPTCHA)} /> : null}
    </article>
  );
}
