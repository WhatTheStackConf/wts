import SparkMD5 from "spark-md5";

export const getGravatarUrl = (email: string | undefined | null) => {
    if (!email) return "";
    const hash = SparkMD5.hash(email.trim().toLowerCase());
    return `https://www.gravatar.com/avatar/${hash}?d=mp`;
};
