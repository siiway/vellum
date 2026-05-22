def fizzbuzz(n: int) -> str:
    """Return the FizzBuzz string for n."""
    if n % 15 == 0:
        return "FizzBuzz"
    if n % 3 == 0:
        return "Fizz"
    if n % 5 == 0:
        return "Buzz"
    return str(n)


def main() -> None:
    for i in range(1, 16):
        print(fizzbuzz(i))


if __name__ == "__main__":
    main()
